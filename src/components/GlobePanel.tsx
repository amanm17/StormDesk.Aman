import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Corridor, Country, Mode } from '../lib/types';
import { fmt, stressColour } from '../lib/weather';
import { Metric } from './widgets';

function toVector3(lat: number, lng: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(-radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta));
}

const clean = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const ALIASES: Record<string, string> = { uk: 'GBR', britain: 'GBR', 'great britain': 'GBR', usa: 'USA', us: 'USA', america: 'USA', uae: 'ARE' };

export default function GlobePanel({ mode, countries, corridors, focusedCountry }: {
  mode: Mode; countries: Country[]; corridors: Corridor[]; focusedCountry?: string | null;
}) {
  const mount = useRef<HTMLDivElement | null>(null);
  const layer = useRef<THREE.Group | null>(null);
  const markers = useRef<THREE.Mesh[]>([]);
  const [selected, setSelected] = useState<Country | null>(null);

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

  // Scene: built once per mode.
  useEffect(() => {
    if (!mount.current) return;
    const el = mount.current;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, el.clientWidth / Math.max(1, el.clientHeight), 0.1, 1000);
    camera.position.set(0, 0.55, 5.75);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.autoRotate = true;
    controls.autoRotateSpeed = mode === 'dense' ? 0.42 : 0.28;
    controls.minDistance = 3.1;
    controls.maxDistance = 7.2;

    const group = new THREE.Group();
    scene.add(group);
    const base = import.meta.env.BASE_URL;
    const loader = new THREE.TextureLoader();
    const earth = new THREE.Mesh(
      new THREE.SphereGeometry(1.72, 96, 96),
      new THREE.MeshPhongMaterial({
        map: loader.load(`${base}textures/earth-blue-marble.jpg`),
        bumpMap: loader.load(`${base}textures/earth-topology.png`),
        bumpScale: 0.045, shininess: 9,
        specular: new THREE.Color(mode === 'dense' ? '#3d0606' : '#113c54'),
      }),
    );
    group.add(earth);
    group.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.77, 96, 96),
      new THREE.MeshBasicMaterial({ color: mode === 'dense' ? '#ef4444' : '#38bdf8', transparent: true, opacity: mode === 'dense' ? 0.17 : 0.13, side: THREE.BackSide }),
    ));
    scene.add(new THREE.AmbientLight('#9ecfff', 1.35));
    const sun = new THREE.DirectionalLight('#ffffff', 2.1);
    sun.position.set(-3, 2, 4);
    scene.add(sun);
    const dataLayer = new THREE.Group();
    group.add(dataLayer);
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
      const w = Math.max(320, mount.current.clientWidth);
      const h = Math.max(420, mount.current.clientHeight);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);
    const timers = [80, 220, 520].map((d) => window.setTimeout(onResize, d));
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
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', onResize);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      controls.dispose();
      renderer.dispose();
      layer.current = null;
      markers.current = [];
      el.innerHTML = '';
    };
  }, [mode]);

  // Data layer: rebuilt whenever countries or corridors change.
  useEffect(() => {
    const g = layer.current;
    if (!g) return;
    g.clear();
    markers.current = [];
    countries.forEach((c) => {
      if (typeof c.lat !== 'number' || typeof c.lng !== 'number') return;
      const pos = toVector3(c.lat, c.lng, 1.82);
      const op = c.confidence >= 75 ? 1 : c.confidence >= 55 ? 0.8 : 0.45;
      const marker = new THREE.Mesh(
        new THREE.SphereGeometry(0.022 + c.stress / 3000, 16, 16),
        new THREE.MeshBasicMaterial({ color: stressColour(c.stress), transparent: true, opacity: op }),
      );
      marker.position.copy(pos);
      marker.userData.country = c;
      g.add(marker);
      markers.current.push(marker);
      if (c.stress >= 61 && c.data_quality === 'ok') {
        const halo = new THREE.Mesh(
          new THREE.SphereGeometry(0.06 + c.stress / 1600, 20, 20),
          new THREE.MeshBasicMaterial({ color: stressColour(c.stress), transparent: true, opacity: mode === 'dense' ? 0.22 : 0.14 }),
        );
        halo.position.copy(pos);
        g.add(halo);
      }
    });
    corridors.forEach((arc) => {
      const start = toVector3(arc.from_lat, arc.from_lng, 1.84);
      const end = toVector3(arc.to_lat, arc.to_lng, 1.84);
      const mid = start.clone().add(end).normalize().multiplyScalar(2.2 + arc.stress / 400);
      const pts = new THREE.QuadraticBezierCurve3(start, mid, end).getPoints(72);
      g.add(new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: stressColour(arc.stress), transparent: true, opacity: mode === 'dense' ? 0.75 : 0.5 }),
      ));
    });
  }, [countries, corridors, mode]);

  const sel = selected;
  return (
    <section className="globe-panel">
      <div className="globe-copy">
        <div className="eyebrow">Country weather · {countries.length} countries · {corridors.length} trade arcs</div>
        <h2>Financial weather globe</h2>
        <p>Drag to rotate. Click a node for its readout. Faded nodes have thin data; arcs are trade corridors coloured by stress.</p>
        {sel && (
          <div className="region-readout region-readout-v4">
            <div className="region-card-header-v4">
              <div className="region-identity-v4">
                <span>Selected country</span>
                <strong>{sel.name}</strong>
              </div>
              <div className="region-score-v4">
                <b style={{ borderColor: stressColour(sel.stress), color: stressColour(sel.stress) }}>{fmt(sel.stress)} · {sel.weather}</b>
                <span>{sel.confidence_label} confidence · {sel.confidence}%{sel.data_quality === 'thin' ? ' · thin data' : ''}</span>
                <small>{sel.iso3}{sel.region ? ` · ${sel.region}` : ''}{sel.currency ? ` · ${sel.currency}` : ''}</small>
              </div>
            </div>
            <ul className="driver-list driver-list-v4">
              {(mode === 'dense' ? sel.drivers : sel.drivers.slice(0, 3)).map((d) => <li key={d}>{d}</li>)}
            </ul>
            {mode === 'dense' && (
              <div className="dense-grid">
                <Metric label="Structural (50%)" value={sel.components.structural} />
                <Metric label="Exposure (20%)" value={sel.components.exposure} />
                <Metric label="Currency (20%)" value={sel.components.currency} />
                <Metric label="News (10%)" value={sel.components.news} />
              </div>
            )}
          </div>
        )}
        <div className="globe-rank">
          <span>Most stressed (well-covered countries)</span>
          {ranked.slice(0, mode === 'dense' ? 10 : 5).map((c) => (
            <button key={c.iso3} onClick={() => setSelected(c)} className={sel?.iso3 === c.iso3 ? 'active' : ''}>
              <span>{c.name}</span><b style={{ color: stressColour(c.stress) }}>{Math.round(c.stress)}</b>
            </button>
          ))}
        </div>
      </div>
      <div className="confidence-legend">
        <span>Node opacity = confidence</span>
        <b className="conf-high">High</b>
        <b className="conf-med">Medium</b>
        <b className="conf-low">Low</b>
      </div>
      <div className="globe-stage">
        <div className="orbit orbit-a" />
        <div className="orbit orbit-b" />
        <div ref={mount} className="earth-canvas" />
      </div>
    </section>
  );
}
