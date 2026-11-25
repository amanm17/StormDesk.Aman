import { useMemo, useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import type { Scenario, Snapshot } from '../lib/types';
import { CLASS_ORDER, signed, stressColour, weatherLabel } from '../lib/weather';

function interp(sc: Scenario, x: number, pick: (s: Scenario['steps'][number]) => number | undefined) {
  const steps = sc.steps;
  if (x <= steps[0].shock) return pick(steps[0]);
  if (x >= steps[steps.length - 1].shock) return pick(steps[steps.length - 1]);
  for (let i = 0; i < steps.length - 1; i++) {
    const a = steps[i];
    const b = steps[i + 1];
    if (x >= a.shock && x <= b.shock) {
      const ya = pick(a);
      const yb = pick(b);
      if (ya === undefined || yb === undefined) return undefined;
      return ya + ((yb - ya) * (x - a.shock)) / (b.shock - a.shock || 1);
    }
  }
  return undefined;
}

const PRESETS: { name: string; shocks: Record<string, number> }[] = [
  { name: 'Oil shock', shocks: { oil: 30, vix: 5, usd: 2 } },
  { name: '2022-style rate shock', shocks: { us10y: 100, usd: 6, equity: -20, credit: 100 } },
  { name: 'Credit event', shocks: { credit: 200, vix: 15, equity: -10, crypto: -30 } },
  { name: 'Dollar squeeze', shocks: { usd: 6, us10y: 50, crypto: -15 } },
  { name: 'Relief rally', shocks: { vix: -8, credit: -50, equity: 5, crypto: 15 } },
];

export default function ScenarioLab({ snapshot }: { snapshot: Snapshot | null }) {
  const scenarios = snapshot?.scenarios ?? [];
  const [shocks, setShocks] = useState<Record<string, number>>({});

  const result = useMemo(() => {
    if (!snapshot) return null;
    const baseClasses: Record<string, number> = {};
    snapshot.asset_classes.forEach((a) => { if (a.key !== 'trade') baseClasses[a.key] = a.score; });
    const classes = { ...baseClasses };
    let gDelta = 0;
    const contributions: { label: string; delta: number }[] = [];
    scenarios.forEach((sc) => {
      const x = shocks[sc.id] ?? 0;
      if (!x) return;
      const zero = sc.steps.find((s) => s.shock === 0);
      const g0 = zero?.global ?? sc.base_global;
      const g = interp(sc, x, (s) => s.global) ?? g0;
      gDelta += g - g0;
      contributions.push({ label: `${sc.label} ${signed(x, 0, ` ${sc.unit}`)}`, delta: g - g0 });
      Object.keys(classes).forEach((k) => {
        const c0 = zero?.classes[k];
        const c = interp(sc, x, (s) => s.classes[k]);
        if (c0 !== undefined && c !== undefined) classes[k] += c - c0;
      });
    });
    const base = snapshot.global.score;
    const scored = Math.max(0, Math.min(100, base + gDelta));
    Object.keys(classes).forEach((k) => { classes[k] = Math.max(0, Math.min(100, classes[k])); });
    return { base, scored, baseClasses, classes, contributions };
  }, [snapshot, scenarios, shocks]);

  if (!snapshot || !result) return <section className="panel"><p className="muted-note">Loading…</p></section>;

  return (
    <section className="focus-page scenario-page">
      <div className="focus-page-copy">
        <h2><FlaskConical size={18} /> Scenario Lab</h2>
        <p>Instant shock to today's data, re-scored with the live engine. Shocks add linearly.</p>
      </div>
      <div className="scenario-grid">
        <div className="panel scenario-controls-panel">
          <div className="preset-row">
            {PRESETS.map((p) => <button key={p.name} onClick={() => setShocks(p.shocks)}>{p.name}</button>)}
            <button onClick={() => setShocks({})} className="ghost"><RotateCcw size={13} /> Reset</button>
          </div>
          {scenarios.map((sc) => {
            const min = sc.steps[0].shock;
            const max = sc.steps[sc.steps.length - 1].shock;
            const step = sc.unit === 'bp' ? 5 : 1;
            const v = shocks[sc.id] ?? 0;
            return (
              <label key={sc.id} className="scenario-slider">
                <div><span>{sc.label}</span><b>{signed(v, 0, ` ${sc.unit}`)}</b></div>
                <input type="range" min={min} max={max} step={step} value={v} onChange={(e) => setShocks((s) => ({ ...s, [sc.id]: Number(e.target.value) }))} />
                <small>{sc.note}</small>
              </label>
            );
          })}
        </div>
        <div className="panel scenario-result-panel">
          <div className="scenario-headline">
            <div>
              <span>Today</span>
              <strong style={{ color: stressColour(result.base) }}>{Math.round(result.base)}</strong>
              <em>{weatherLabel(result.base)}</em>
            </div>
            <div className="arrow">→</div>
            <div>
              <span>Scenario</span>
              <strong style={{ color: stressColour(result.scored) }}>{Math.round(result.scored)}</strong>
              <em>{weatherLabel(result.scored)}</em>
            </div>
          </div>
          {result.contributions.length > 0 && (
            <ul className="scenario-contrib">
              {result.contributions.map((c) => <li key={c.label}><span>{c.label}</span><b>{signed(c.delta)}</b></li>)}
            </ul>
          )}
          <table className="indicator-table scenario-table">
            <thead><tr><th>Class</th><th>Today</th><th>Scenario</th><th>Δ</th></tr></thead>
            <tbody>
              {CLASS_ORDER.filter((k) => result.baseClasses[k] !== undefined).map((k) => {
                const a = result.baseClasses[k];
                const b = result.classes[k];
                return (
                  <tr key={k}>
                    <td>{snapshot.asset_classes.find((x) => x.key === k)?.title}</td>
                    <td style={{ color: stressColour(a) }}>{Math.round(a)} <small>{weatherLabel(a)}</small></td>
                    <td style={{ color: stressColour(b) }}>{Math.round(b)} <small>{weatherLabel(b)}</small></td>
                    <td>{signed(b - a)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
