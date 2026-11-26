import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Corridor, Country, Mode } from '../lib/types';
import type { Theme } from '../lib/weather';
import { fmt, stressColour } from '../lib/weather';
import { Metric } from './widgets';

function toVector3(lat: number, lng: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
}

/** Subsolar point (where the sun is overhead) for a moment, from the NOAA low-precision solar formulas. */
export function subsolarPoint(date = new Date()) {
  const rad = Math.PI / 180;
  const d = (date.getTime() - Date.UTC(2000, 0, 1, 12)) / 864e5;
  const g = (357.529 + 0.98560028 * d) * rad;
  const q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const e = (23.439 - 0.00000036 * d) * rad;
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L)) / rad;
  const dec = Math.asin(Math.sin(e) * Math.sin(L)) / rad;
  let eqt = (q - ra) / 15;
  eqt = ((eqt + 12) % 24 + 24) % 24 - 12;
  const utcHours = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lng = -15 * (utcHours - 12 + eqt);
  lng = ((lng + 180) % 360 + 360) % 360 - 180;
  return { lat: dec, lng };
}

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    vUv = uv;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewDir = normalize(cameraPosition - world.xyz);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D nightMap;
  uniform vec3 sunDir;
  uniform float uDay;      // 1 = Day theme, 0 = Night theme
  varying vec2 vUv;
  varying vec3 vNormalW;
  varying vec3 vViewDir;
  void main() {
    float cosSun = dot(normalize(vNormalW), normalize(sunDir));
    vec3 dayCol = texture2D(dayMap, vUv).rgb;
    vec3 nightCol = texture2D(nightMap, vUv).rgb;
    float lit = smoothstep(-0.14, 0.18, cosSun);
    // Sunlit side: soft Lambert with a lifted floor so oceans keep their colour.
    vec3 dayShade = dayCol * (0.42 + 0.95 * max(cosSun, 0.0)) * mix(1.0, 1.12, uDay);
    // Dark side: city lights, plus a faint moonlit continent layer (stronger in Day theme so the globe reads on a light page).
    vec3 lights = nightCol * vec3(1.25, 1.05, 0.75);
    vec3 nightShade = lights * mix(2.1, 1.7, uDay) + dayCol * mix(0.06, 0.14, uDay);
    vec3 col = mix(nightShade, dayShade, lit);
    // Twilight: a warm band along the terminator.
    float dusk = 1.0 - smoothstep(0.0, 0.2, abs(cosSun + 0.02));
    col += vec3(1.0, 0.46, 0.18) * dusk * 0.22;
    // Specular glint on the sunlit oceans (blue-dominant pixels).
    float ocean = smoothstep(0.05, 0.25, dayCol.b - dayCol.r);
    vec3 h = normalize(normalize(sunDir) + vViewDir);
    col += vec3(1.0, 0.95, 0.85) * pow(max(dot(normalize(vNormalW), h), 0.0), 60.0) * ocean * 0.55 * lit;
    // Rim light.
    float rim = pow(1.0 - max(dot(normalize(vNormalW), vViewDir), 0.0), 3.0);
    col += mix(vec3(0.20, 0.32, 0.75), vec3(0.45, 0.72, 1.0), uDay) * rim * 0.35;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const ATMO_VERT = /* glsl */ `
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const ATMO_FRAG = /* glsl */ `
  uniform vec3 glow;
  uniform vec3 sunDir;
  uniform float strength;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  void main() {
    vec3 viewDir = normalize(cameraPosition - vWorld);
    float fres = pow(0.72 - dot(normalize(vNormalW), viewDir), 4.0) * 1.6;
    float sunSide = 0.45 + 0.55 * smoothstep(-0.4, 0.6, dot(normalize(vNormalW), normalize(sunDir)));
    gl_FragColor = vec4(glow, 1.0) * clamp(fres, 0.0, 1.0) * strength * sunSide;
  }
`;

/** Camera position looking at the sunlit hemisphere (Day) or the night hemisphere (Night), with the terminator in view. */
function viewFor(theme: Theme, sun: { lat: number; lng: number }) {
  const lng = theme === 'day' ? sun.lng - 35 : sun.lng + 180 - 35;
  const lat = Math.max(-35, Math.min(35, theme === 'day' ? sun.lat * 0.6 + 15 : -sun.lat * 0.6 + 20));
  return toVector3(lat, lng, 5.75);
}

const clean = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES: Record<string, string> = { uk: 'GBR', britain: 'GBR', 'great britain': 'GBR', usa: 'USA', us: 'USA', america: 'USA', uae: 'ARE' };

export default function GlobePanel({ mode, theme, countries, corridors, focusedCountry, compact = false }: {
  mode: Mode; theme: Theme; countries: Country[]; corridors: Corridor[]; focusedCountry?: string | null; compact?: boolean;
}) {
  const mount = useRef<HTMLDivElement | null>(null);
  const layer = useRef<THREE.Group | null>(null);
  const markers = useRef<THREE.Mesh[]>([]);
  const cam = useRef<{ camera: THREE.PerspectiveCamera; controls: OrbitControls } | null>(null);
  const lastTheme = useRef<Theme>(theme);
  const uniforms = useRef<{ earth: Record<string, THREE.IUniform>; atmo: Record<string, THREE.IUniform>; stars: THREE.PointsMaterial | null }>({ earth: {}, atmo: {}, stars: null });
  const [selected, setSelected] = useState<Country | null>(null);
  const [sun, setSun] = useState(() => subsolarPoint());

  const ranked = useMemo(() => [...countries].filter((c) => c.data_quality === 'ok').sort((a, b) => b.stress - a.stress), [countries]);

  useEffect(() => {
    if (!selected && countries.length) setSelected(countries.find((c) => c.iso3 === 'IND') ?? ranked[0] ?? countries[0]);
  }, [countries, ranked, selected]);

  useEffect(() => {
    if (!focusedCountry || !countries.length) return;
    const t = clean(focusedCountry);
    const hit =
      countries.find((c) => clean(c.name) === t) ??
      countries.find((c) => clean(c.iso3) === t || clean(c.iso2) === t) ??
      countries.find((c) => c.iso3 === ALIASES[t]) ??
      countries.find((c) => clean(c.name).split(' ').includes(t));
    if (hit) setSelected(hit);
  }, [focusedCountry, countries]);

  // The sun moves 0.25° a minute; update the terminator every minute.
  useEffect(() => {
    const t = window.setInterval(() => setSun(subsolarPoint()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  // Scene: built once.
  useEffect(() => {
    if (!mount.current) return;
    const el = mount.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / Math.max(1, el.clientHeight), 0.1, 1000);
    const start = subsolarPoint();
    camera.position.copy(viewFor(theme, start));
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.3;
    controls.minDistance = 3.1;
    controls.maxDistance = 7.2;

    const base = import.meta.env.BASE_URL;
    const loader = new THREE.TextureLoader();
    const dayMap = loader.load(`${base}textures/earth-blue-marble.jpg`);
    const nightMap = loader.load(`${base}textures/earth-night.jpg`);
    // Sampled as raw sRGB and written straight out (ShaderMaterial does no colour-space conversion).
    [dayMap, nightMap].forEach((t) => { t.anisotropy = 4; });
    const sunVec = toVector3(start.lat, start.lng, 1).normalize();

    const earthU = { dayMap: { value: dayMap }, nightMap: { value: nightMap }, sunDir: { value: sunVec.clone() }, uDay: { value: 0 } };
    const earth = new THREE.Mesh(new THREE.SphereGeometry(1.72, 128, 128), new THREE.ShaderMaterial({ uniforms: earthU, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG }));
    scene.add(earth);

    const atmoU = { glow: { value: new THREE.Color('#3b6fff') }, sunDir: { value: sunVec.clone() }, strength: { value: 0.9 } };
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.84, 96, 96),
      new THREE.ShaderMaterial({ uniforms: atmoU, vertexShader: ATMO_VERT, fragmentShader: ATMO_FRAG, side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false }),
    ));

    // Starfield (fades out in Day theme).
    const starGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 1400; i++) {
      const u = rand() * 2 - 1;
      const th = rand() * Math.PI * 2;
      const r = 40 + rand() * 30;
      pts.push(r * Math.sqrt(1 - u * u) * Math.cos(th), r * u, r * Math.sqrt(1 - u * u) * Math.sin(th));
    }
    starGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const starMat = new THREE.PointsMaterial({ color: '#dbe7ff', size: 0.18, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false });
    scene.add(new THREE.Points(starGeo, starMat));

    uniforms.current = { earth: earthU, atmo: atmoU, stars: starMat };
    cam.current = { camera, controls };
    earthU.uDay.value = theme === 'day' ? 1 : 0;
    starMat.opacity = theme === 'day' ? 0 : 0.85;
    atmoU.glow.value.set(theme === 'day' ? '#7cc4ff' : '#3b6fff');
    const dataLayer = new THREE.Group();
    scene.add(dataLayer);
    layer.current = dataLayer;

    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();
    const onPointerDown = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(mouse, camera);
      const hit = raycaster.intersectObjects(markers.current)[0];
      if (hit?.object?.userData?.country) setSelected(hit.object.userData.country as Country);
    };
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    const onResize = () => {
      if (!mount.current) return;
      const w = Math.max(280, mount.current.clientWidth);
      const h = Math.max(320, mount.current.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    const ro = new ResizeObserver(onResize);
    ro.observe(el);
    let raf = 0;
    const animate = () => {
      raf = requestAnimationFrame(animate);
      const t = Date.now() / 520;
      markers.current.forEach((m, i) => m.scale.setScalar(1 + Math.sin(t + i) * 0.12));
      controls.update();
      renderer.render(scene, camera);
    };
    animate();
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      renderer.dispose();
      layer.current = null;
      cam.current = null;
      markers.current = [];
      el.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sun position.
  useEffect(() => {
    const v = toVector3(sun.lat, sun.lng, 1).normalize();
    (uniforms.current.earth.sunDir?.value as THREE.Vector3 | undefined)?.copy(v);
    (uniforms.current.atmo.sunDir?.value as THREE.Vector3 | undefined)?.copy(v);
  }, [sun]);

  // Theme: animate uniforms between Day and Night.
  useEffect(() => {
    const u = uniforms.current;
    if (!u.earth.uDay) return;
    const from = u.earth.uDay.value as number;
    const to = theme === 'day' ? 1 : 0;
    const glowFrom = (u.atmo.glow.value as THREE.Color).clone();
    const starFrom = u.stars?.opacity ?? 0.85;
    const starTo = theme === 'day' ? 0 : 0.85;
    const glowTo = new THREE.Color(theme === 'day' ? (mode === 'dense' ? '#ff7a6b' : '#6fb6ff') : mode === 'dense' ? '#ff5a4f' : '#3b6fff');
    const t0 = performance.now();
    let raf = 0;
    // Swing the camera to the sunlit side (Day) or the city-lit side (Night).
    const c = cam.current;
    const camFrom = c ? c.camera.position.clone() : null;
    const camTo = c ? viewFor(theme, subsolarPoint()).setLength(c.camera.position.length()) : null;
    const swing = lastTheme.current !== theme && camFrom && camTo && camFrom.angleTo(camTo) > 0.35;
    lastTheme.current = theme;
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 1100);
      const e = k * k * (3 - 2 * k);
      u.earth.uDay.value = from + (to - from) * e;
      (u.atmo.glow.value as THREE.Color).copy(glowFrom).lerp(glowTo, e);
      u.atmo.strength.value = theme === 'day' ? 0.75 : 0.9;
      if (swing && c && camFrom && camTo) {
        const r = camFrom.length();
        c.camera.position.copy(camFrom.clone().normalize().lerp(camTo.clone().normalize(), e).normalize().multiplyScalar(r));
        c.camera.lookAt(0, 0, 0);
      }
      if (u.stars) u.stars.opacity = starFrom + (starTo - starFrom) * e;
      if (k < 1) raf = requestAnimationFrame(step);
    };
    step();
    return () => cancelAnimationFrame(raf);
  }, [theme, mode]);

  // Data layer.
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clear();
    markers.current = [];
    countries.forEach((c) => {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
      const pos = toVector3(c.lat, c.lng, 1.8);
      const op = c.confidence >= 75 ? 1 : c.confidence >= 55 ? 0.8 : 0.4;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.02 + c.stress / 3200, 14, 14),
        new THREE.MeshBasicMaterial({ color: stressColour(c.stress), transparent: true, opacity: op }),
      );
      marker.position.copy(pos);
      marker.userData.country = c;
      g.add(marker);
      markers.current.push(marker);
      if (c.stress >= 61 && c.data_quality === 'ok') {
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(0.055 + c.stress / 1700, 18, 18),
          new THREE.MeshBasicMaterial({ color: stressColour(c.stress), transparent: true, opacity: theme === 'day' ? 0.2 : 0.16, depthWrite: false }),
        );
        halo.position.copy(pos);
        g.add(halo);
      }
    });
    corridors.forEach((arc) => {
      const start = toVector3(arc.from_lat, arc.from_lng, 1.82);
      const end = toVector3(arc.to_lat, arc.to_lng, 1.82);
      const mid = start.clone().add(end).normalize().multiplyScalar(2.2 + arc.stress / 400);
      const pts = new THREE.QuadraticBezierCurve3(start, mid, end).getPoints(72);
      g.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: stressColour(arc.stress), transparent: true, opacity: mode === 'dense' ? 0.8 : 0.6 }),
      ));
    });
  }, [countries, corridors, mode, theme]);

  const sel = selected;
  const sunText = `Sun overhead ${Math.abs(sun.lat).toFixed(1)}°${sun.lat >= 0 ? 'N' : 'S'} ${Math.abs(sun.lng).toFixed(0)}°${sun.lng >= 0 ? 'E' : 'W'}`;
  return (
    <section className={`globe-panel sd-globe ${compact ? 'compact' : ''}`}>
      <div className="globe-copy">
        <div className="eyebrow">{countries.length} countries · {corridors.length} corridors</div>
        <h2>Country weather</h2>
        {sel && (
          <div className="region-readout region-readout-v4">
            <div className="region-card-header-v4">
              <div className="region-identity-v4">
                <span>{sel.iso3}{sel.currency ? ` · ${sel.currency}` : ''}</span>
                <strong>{sel.name}</strong>
              </div>
              <div className="region-score-v4">
                <b style={{ borderColor: stressColour(sel.stress), color: stressColour(sel.stress) }}>{fmt(sel.stress)} · {sel.weather}</b>
                <span>Conf {sel.confidence}%{sel.data_quality === 'thin' ? ' · thin data' : ''}</span>
              </div>
            </div>
            <ul className="driver-list driver-list-v4">
              {(mode === 'dense' ? sel.drivers : sel.drivers.slice(0, 3)).map((d) => <li key={d}>{d}</li>)}
            </ul>
            {mode === 'dense' && (
              <div className="dense-grid">
                <Metric label="Structural 50%" value={sel.components.structural} />
                <Metric label="Exposure 20%" value={sel.components.exposure} />
                <Metric label="Currency 20%" value={sel.components.currency} />
                <Metric label="News 10%" value={sel.components.news} />
              </div>
            )}
          </div>
        )}
        {!compact && (
          <div className="globe-rank">
            <span>Highest stress</span>
            {ranked.slice(0, mode === 'dense' ? 10 : 6).map((c) => (
              <button key={c.iso3} onClick={() => setSelected(c)} className={sel?.iso3 === c.iso3 ? 'active' : ''}>
                <span>{c.name}</span><b style={{ color: stressColour(c.stress) }}>{Math.round(c.stress)}</b>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="globe-legend">
        <span>{sunText}</span>
        <span>Faded = thin data</span>
      </div>
      <div className="globe-stage">
        <div ref={mount} className="earth-canvas" />
      </div>
    </section>
  );
}
