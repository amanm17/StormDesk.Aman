import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Database, ShieldAlert, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { Alert, AssetClass, Corridor, CorridorPayload, HealthPayload, Indicator, Mode, Snapshot } from '../lib/types';
import { ageHours, ageText, fmt, ordinal, signed, stressColour, usd, weatherLabel } from '../lib/weather';

export function Sparkline({ values, colour, height = 40 }: { values: (number | null)[]; colour: string; height?: number }) {
  const v = values.filter((x): x is number => x !== null && x !== undefined);
  if (v.length < 2) return <svg className="sparkline" viewBox={`0 0 100 ${height}`} />;
  const max = Math.max(...v);
  const min = Math.min(...v);
  const pts = v
    .map((x, i) => `${(i / (v.length - 1)) * 100},${height - 4 - ((x - min) / Math.max(1, max - min)) * (height - 10)}`)
    .join(' ');
  return (
    <svg className="sparkline" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <polyline fill="none" stroke="var(--sd-rule)" strokeWidth="1" points={`0,${height - 4} 100,${height - 4}`} />
      <polyline fill="none" stroke={colour} strokeWidth="2.2" points={pts} />
    </svg>
  );
}

export function Metric({ label, value, text }: { label: string; value: number | null | undefined; text?: string }) {
  const w = value === null || value === undefined ? 0 : Math.max(4, Math.min(100, value));
  return (
    <div className="metric">
      <span>{label}</span>
      <i><b style={{ width: `${w}%` }} /></i>
      <strong>{text ?? (value === null || value === undefined ? 'n/a' : Math.round(value))}</strong>
    </div>
  );
}

function DeltaIcon({ d }: { d: number | null | undefined }) {
  if (d === null || d === undefined || Math.abs(d) < 1) return <Minus size={13} />;
  return d > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />;
}

export function StressTile({ cls, mode, indicators, onOpen }: { cls: AssetClass; mode: Mode; indicators: Indicator[]; onOpen?: (key: string) => void }) {
  const colour = stressColour(cls.score);
  const members = indicators.filter((i) => i.asset_class === cls.key && i.available);
  const avg = (k: 'P' | 'z') => {
    const xs = members.map((m) => m[k]).filter((x): x is number => typeof x === 'number');
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  return (
    <article className="stress-tile" onClick={() => onOpen?.(cls.key)} role={onOpen ? 'button' : undefined}>
      <div className="tile-head">
        <div>
          <span className="eyebrow">{cls.weather}</span>
          <h3>{cls.title}</h3>
        </div>
        <div className="tile-score" style={{ color: colour }}>{Math.round(cls.score)}</div>
      </div>
      <p>{cls.driver}</p>
      {cls.series.length > 1 && <Sparkline values={cls.series} colour={colour} />}
      <div className="tile-foot">
        <span><DeltaIcon d={cls.delta_5d} /> {cls.delta_5d === null ? 'annual' : `${signed(cls.delta_5d)} 5d`}</span>
        <span>conf {cls.confidence}%</span>
      </div>
      {mode === 'dense' && (
        <>
          <div className="dense-grid">
            <Metric label="Pctl" value={avg('P')} />
            <Metric label="Mom z" value={avg('z') === null ? null : ((avg('z') as number) + 3) * 16.7} text={avg('z') === null ? 'n/a' : (avg('z') as number).toFixed(2)} />
            <Metric label="Conf" value={cls.confidence} />
          </div>
          {cls.members.length > 0 && (
            <ul className="tile-members">
              {cls.members.map((m) => (
                <li key={m.key}><span>{m.label}</span><b style={{ color: stressColour(m.stress) }}>{m.stress === null ? 'n/a' : Math.round(m.stress)}</b></li>
              ))}
            </ul>
          )}
        </>
      )}
    </article>
  );
}

export function Headline({ snapshot, mode }: { snapshot: Snapshot | null; mode: Mode }) {
  if (!snapshot) {
    return <section className="sd-headline"><div className="sd-headline-text"><h1>Loading…</h1></div></section>;
  }
  const g = snapshot.global;
  const f = snapshot.forecast;
  const colour = stressColour(g.score);
  const leaders = [...snapshot.asset_classes].filter((a) => a.key !== 'trade').sort((a, b) => b.score - a.score).slice(0, 3);
  return (
    <section className="sd-headline">
      <div className="sd-headline-text">
        <h1>Global stress is <span style={{ color: colour }}>{Math.round(g.score)}</span>, {g.weather}.</h1>
        <p className="sd-sub">
          {signed(g.delta_5d)} on the week · {signed(g.delta_20d)} on the month · {ordinal(g.percentile_since_2015)} percentile since 2015
        </p>
        <p className="sd-leaders">
          {leaders.map((l, i) => (
            <span key={l.key}>{i > 0 && ' · '}{l.title} <b style={{ color: stressColour(l.score) }}>{Math.round(l.score)}</b></span>
          ))}
        </p>
      </div>
      <div className="sd-kpis">
        <div className="sd-kpi">
          <span>Regime</span>
          <strong>{snapshot.regime.name}</strong>
          <small>{snapshot.regime.why}</small>
        </div>
        <div className="sd-kpi">
          <span>Next week</span>
          <strong style={{ color: f['1w'] ? stressColour(f['1w'].mean) : undefined }}>{f['1w'] ? Math.round(f['1w'].mean) : 'n/a'}</strong>
          <small>{f['1w'] ? `80%: ${Math.round(f['1w'].low)}–${Math.round(f['1w'].high)} · ${f.direction}` : ''}</small>
        </div>
        <div className="sd-kpi">
          <span>Contagion</span>
          <strong>{ordinal(snapshot.correlation.percentile)}</strong>
          <small>pctl · adj +{fmt(g.contagion_adj, 1)}</small>
        </div>
        <div className="sd-kpi">
          <span>Confidence</span>
          <strong>{g.confidence}%</strong>
          <small>{mode === 'dense' ? `breadth ${fmt(g.breadth)}% · raw ${fmt(g.raw_weighted, 1)}` : `as of ${snapshot.as_of}`}</small>
        </div>
      </div>
    </section>
  );
}

const SEV_ICON = { high: <AlertTriangle size={14} />, medium: <ShieldAlert size={14} />, low: <TrendingDown size={14} /> };

export function AlertFeed({ alerts, mode }: { alerts: Alert[]; mode: Mode }) {
  const shown = mode === 'dense' ? alerts : alerts.slice(0, 6);
  return (
    <section className="panel alert-panel">
      <div className="panel-title">
        <ShieldAlert size={17} />
        <h2>Alerts</h2>
        <span>{alerts.length}</span>
      </div>
      {shown.map((a, i) => (
        <article className={`alert-item ${a.severity}`} key={`${a.text}-${i}`}>
          <time>{SEV_ICON[a.severity]} {a.date ? a.date.slice(5) : ''}</time>
          <strong>{a.text}</strong>
        </article>
      ))}
      {!alerts.length && <p className="muted-note">No alerts</p>}
    </section>
  );
}

export function EventRiskPanel({ snapshot }: { snapshot: Snapshot | null }) {
  const er = snapshot?.event_risk;
  const events = er?.top_events ?? [];
  return (
    <section className="panel event-risk-panel">
      <div className="panel-title">
        <CalendarClock size={17} />
        <h2>Events</h2>
        <span>{er?.event_weather ?? ''}</span>
      </div>
      <div className="event-risk-score">
        <strong>{er?.event_risk_score ?? 0}</strong>
        <span>event pressure</span>
      </div>
      <div className="event-list">
        {events.slice(0, 6).map((e) => (
          <div className="event-row" key={`${e.date}-${e.event}`}>
            <div>
              <strong>{e.event}</strong>
              <span>{e.region} · {e.date}</span>
            </div>
            <b>{e.days_until === 0 ? 'today' : `${e.days_until}d`}</b>
          </div>
        ))}
        {!events.length && <p className="muted-note">No events in the calendar</p>}
      </div>
      {er?.needs_update && <p className="muted-note warn">Calendar running out: add the next schedule</p>}
    </section>
  );
}

export function TradeCorridorsPanel({ payload, mode, focusedQuery }: { payload: CorridorPayload | null; mode: Mode; focusedQuery?: string | null }) {
  const [filter, setFilter] = useState('all');
  const corridors = payload?.corridors ?? [];
  const focus = String(focusedQuery ?? '').toLowerCase();
  useEffect(() => { if (focusedQuery) setFilter('all'); }, [focusedQuery]);

  const ranked = useMemo(() => {
    const tokens = focus.split(/\s+/).filter(Boolean);
    return corridors
      .filter((c) => filter === 'all' || c.commodity_class === filter)
      .map((c) => {
        const hay = [c.from_name, c.to_name, c.from, c.to, c.commodity, c.commodity_class].join(' ').toLowerCase();
        const score = tokens.reduce((s, t) => s + (hay.includes(t) ? 1 : 0), 0);
        return { c, score };
      })
      .sort((a, b) => (focus && b.score !== a.score ? b.score - a.score : b.c.stress - a.c.stress))
      .map((x) => ({ ...x.c, _focus: x.score > 0 }));
  }, [corridors, filter, focus]);

  const list = ranked.slice(0, mode === 'dense' ? 14 : 6);
  const sel: (Corridor & { _focus: boolean }) | undefined = list[0];
  const filters: [string, string][] = [['all', 'All'], ['energy', 'Energy'], ['metals', 'Metals'], ['manufactures', 'Manufactures'], ['services', 'Services']];

  return (
    <section id="trade-corridors-panel" className="panel trade-corridor-panel">
      <div className="panel-title">
        <span className="live-dot" />
        <h2>Trade corridors</h2>
        <span>{corridors.length} · index {payload?.trade_score ?? 'n/a'}</span>
      </div>
      {focusedQuery && <div className="corridor-focus-banner"><span>Search</span><strong>{focusedQuery}</strong></div>}
      <div className="corridor-filters">
        {filters.map(([k, label]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{label}</button>)}
      </div>
      {sel && (
        <div className="corridor-feature-card">
          <div>
            <span>{sel._focus ? 'Search match' : 'Highest'}</span>
            <strong>{sel.from_name} → {sel.to_name}</strong>
            <small>{sel.commodity} · {sel.trade_value_usd ? `${usd(sel.trade_value_usd)} (${sel.trade_year})` : 'no goods value'} · conf {sel.confidence}%</small>
          </div>
          <b style={{ color: stressColour(sel.stress) }}>{Math.round(sel.stress)}</b>
        </div>
      )}
      <div className="corridor-list">
        {list.map((c) => (
          <div className={c._focus ? 'corridor-row focused-corridor-row' : 'corridor-row'} key={c.id}>
            <div>
              <strong>{c.from_name} → {c.to_name}</strong>
              <span>
                {c.commodity}
                {c.share_of_importer_imports !== null ? ` · ${c.share_of_importer_imports.toFixed(1)}% of imports` : ''}
              </span>
              {mode === 'dense' && <small>{c.drivers.join(' · ')}</small>}
            </div>
            <b style={{ color: stressColour(c.stress) }}>{Math.round(c.stress)}</b>
          </div>
        ))}
        {!list.length && <p className="muted-note">No corridors</p>}
      </div>
    </section>
  );
}

export function DataHealthPanel({ health, mode, snapshot }: { health: HealthPayload | null; mode: Mode; snapshot?: Snapshot | null }) {
  const sources = health?.sources ?? [];
  const s = health?.summary;
  const shown = mode === 'dense' ? sources : sources.slice(0, 5);
  return (
    <section className="panel data-health-panel">
      <div className="panel-title">
        <Database size={17} />
        <h2>Data health</h2>
        <span>{s?.overall_health ?? ''}</span>
      </div>
      <div className="data-health-summary">
        <div><span>Live</span><strong>{s?.live_count ?? 0}</strong></div>
        <div><span>Degraded</span><strong>{s?.proxy_or_partial_count ?? 0}</strong></div>
        <div><span>Failed</span><strong>{s?.blocked_or_missing_count ?? 0}</strong></div>
        <div><span>Conf</span><strong>{s?.average_confidence ?? 0}</strong></div>
      </div>
      <div className="data-source-list">
        {shown.map((src) => (
          <div className={`data-source-row status-${src.status}`} key={src.key}>
            <div>
              <strong>{src.label}</strong>
              <span>{src.health}{src.latest_observation ? ` · ${src.latest_observation}` : ''}</span>
              {mode === 'dense' && <small>{src.note}</small>}
            </div>
            <b>{src.confidence}</b>
          </div>
        ))}
      </div>
      {snapshot && <p className="muted-note small">Snapshot {ageText(snapshot.generated_at)}</p>}
    </section>
  );
}

export function StaleBanner({ snapshot, error }: { snapshot: Snapshot | null; error: string | null }) {
  const h = ageHours(snapshot?.generated_at);
  if (error && !snapshot) return <div className="stale-banner bad">Couldn't load data ({error}). Reload the page.</div>;
  if (h !== null && h > 30) {
    return (
      <div className="stale-banner">
        Data last refreshed {ageText(snapshot?.generated_at)}. Check the "Refresh StormDesk data" workflow in GitHub Actions.
      </div>
    );
  }
  return null;
}

export function IndicatorTable({ indicators, onPick, selected }: { indicators: Indicator[]; onPick?: (k: string) => void; selected?: string | null }) {
  const rows = indicators.filter((i) => i.available).sort((a, b) => (b.stress ?? 0) - (a.stress ?? 0));
  return (
    <div className="indicator-table-wrap">
      <table className="indicator-table">
        <thead>
          <tr>
            <th>Indicator</th><th>Class</th><th>Value</th><th>Date</th><th>20d chg</th><th>Level pctl</th><th>Mom z</th><th>Stress</th><th>Conf</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((i) => (
            <tr key={i.key} className={selected === i.key ? 'active' : ''} onClick={() => onPick?.(i.key)}>
              <td title={i.note}>{i.label}</td>
              <td>{i.asset_class}</td>
              <td>{i.display}</td>
              <td>{i.date?.slice(5)}</td>
              <td>{i.change_20d === null || i.change_20d === undefined ? 'n/a' : signed(i.change_20d, 2, i.transform === 'pct' ? '%' : '')}</td>
              <td>{fmt(i.level_percentile)}</td>
              <td>{i.z === null || i.z === undefined ? 'n/a' : i.z.toFixed(2)}</td>
              <td><b style={{ color: stressColour(i.stress) }}>{fmt(i.stress)}</b> <small>{weatherLabel(i.stress)}</small></td>
              <td>{i.confidence}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
