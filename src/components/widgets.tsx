import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CalendarClock, Database, ShieldAlert, TrendingDown, TrendingUp, Minus } from 'lucide-react';
import type { Alert, AssetClass, Corridor, CorridorPayload, HealthPayload, Indicator, Mode, Snapshot } from '../lib/types';
import { ageHours, ageText, fmt, signed, stressColour, usd, weatherLabel } from '../lib/weather';

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
      <polyline fill="none" stroke="rgba(255,255,255,0.11)" strokeWidth="1" points={`0,${height - 4} 100,${height - 4}`} />
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
        <span><DeltaIcon d={cls.delta_5d} /> {cls.delta_5d === null ? 'annual data' : `${signed(cls.delta_5d)} in 5 days`}</span>
        <span>conf {cls.confidence}%</span>
      </div>
      {mode === 'dense' && (
        <>
          <div className="dense-grid">
            <Metric label="Avg percentile" value={avg('P')} />
            <Metric label="Avg momentum z" value={avg('z') === null ? null : ((avg('z') as number) + 3) * 16.7} text={avg('z') === null ? 'n/a' : (avg('z') as number).toFixed(2)} />
            <Metric label="Confidence" value={cls.confidence} />
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

export function HeroPanel({ snapshot, mode }: { snapshot: Snapshot | null; mode: Mode }) {
  if (!snapshot) {
    return (
      <section className="panel hero-panel">
        <span className="eyebrow">Global Financial Weather</span>
        <div className="score-ring"><strong>…</strong><span>/100</span></div>
        <h1>Loading</h1>
        <p>Reading the latest snapshot.</p>
      </section>
    );
  }
  const g = snapshot.global;
  const f = snapshot.forecast;
  const colour = stressColour(g.score);
  const top = [...snapshot.asset_classes].filter((a) => a.key !== 'trade').sort((a, b) => b.score - a.score).slice(0, 3);
  return (
    <section className="panel hero-panel" style={{ ['--hero-colour' as string]: colour }}>
      <span className="eyebrow">Global Financial Weather · as of {snapshot.as_of}</span>
      <div className="score-ring" style={{ borderColor: colour }}>
        <strong style={{ color: colour }}>{Math.round(g.score)}</strong>
        <span>/100</span>
      </div>
      <h1 style={{ color: colour }}>{g.weather}</h1>
      <p>
        Stress is concentrated in {top.map((t) => `${t.title.toLowerCase()} (${Math.round(t.score)})`).join(', ')}.{' '}
        Regime: <b>{snapshot.regime.name}</b>. {snapshot.regime.why}
      </p>
      <div className="hero-kpis">
        <div><span>5-day change</span><strong>{signed(g.delta_5d)}</strong></div>
        <div><span>20-day change</span><strong>{signed(g.delta_20d)}</strong></div>
        <div><span>Next week</span><strong>{f['1w'] ? `${Math.round(f['1w'].mean)} (${f['1w'].low}–${f['1w'].high})` : 'n/a'}</strong></div>
        <div><span>Outlook</span><strong className={`dir-${f.direction}`}>{f.direction ?? 'n/a'}</strong></div>
      </div>
      {mode === 'dense' && (
        <div className="serious-metrics hero-extra">
          <div><span>Since 2015</span><strong>{fmt(g.percentile_since_2015)}th pct</strong></div>
          <div><span>Contagion adj.</span><strong>+{fmt(g.contagion_adj, 1)}</strong></div>
          <div><span>Breadth</span><strong>{fmt(g.breadth)}%</strong></div>
          <div><span>Confidence</span><strong>{g.confidence}%</strong></div>
        </div>
      )}
      <div className="source-status-strip">
        <span>Data refreshed {ageText(snapshot.generated_at)}</span>
        {Object.entries(snapshot.source_status)
          .filter(([k]) => k !== 'errors')
          .map(([k, v]) => <b key={k} className={`status-${v}`}>{k}: {String(v)}</b>)}
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
        <h2>Pressure alerts</h2>
        <span>{alerts.length} active</span>
      </div>
      {shown.map((a, i) => (
        <article className={`alert-item ${a.severity}`} key={`${a.text}-${i}`}>
          <time>{SEV_ICON[a.severity]} {a.date ? a.date.slice(5) : ''}</time>
          <strong>{a.text}</strong>
        </article>
      ))}
      {!alerts.length && <p className="muted-note">No rule-based alerts are firing. Conditions are within their normal ranges.</p>}
      <p className="muted-note small">Alerts are rule-based readings of the data, not trading advice.</p>
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
        <h2>Event watch</h2>
        <span>{er?.event_weather ?? 'Calendar unavailable'}</span>
      </div>
      <div className="event-risk-score">
        <strong>{er?.event_risk_score ?? 0}</strong>
        <span>scheduled-event pressure</span>
      </div>
      <div className="event-list">
        {events.slice(0, 6).map((e) => (
          <div className="event-row" key={`${e.date}-${e.event}`}>
            <div>
              <strong>{e.event}</strong>
              <span>{e.region} · {e.date} · {e.weather}</span>
            </div>
            <b>{e.days_until === 0 ? 'today' : `${e.days_until}d`}</b>
          </div>
        ))}
        {!events.length && <p className="muted-note">No scheduled events found.</p>}
      </div>
      {er?.needs_update && <p className="muted-note warn">Calendar needs the next official schedule added.</p>}
      <p className="muted-note small">{er?.model_note}</p>
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
        <span>{corridors.length} routes · trade weather {payload?.trade_score ?? 'n/a'}</span>
      </div>
      {focusedQuery && <div className="corridor-focus-banner"><span>Search focus</span><strong>{focusedQuery}</strong></div>}
      <div className="corridor-filters">
        {filters.map(([k, label]) => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{label}</button>)}
      </div>
      {sel && (
        <div className="corridor-feature-card">
          <div>
            <span>{sel._focus ? `Search match · ${focusedQuery}` : 'Highest current corridor pressure'}</span>
            <strong>{sel.from_name} → {sel.to_name}</strong>
            <small>{sel.commodity} · {sel.weather} · {sel.trade_value_usd ? `${usd(sel.trade_value_usd)} (${sel.trade_year})` : 'goods value n/a'} · confidence {sel.confidence}</small>
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
                {c.commodity} · {c.weather}
                {c.share_of_importer_imports !== null ? ` · ${c.share_of_importer_imports.toFixed(1)}% of ${c.to_name}'s imports` : ''}
              </span>
              {mode === 'dense' && <small>{c.drivers.join(' · ')}</small>}
            </div>
            <b style={{ color: stressColour(c.stress) }}>{Math.round(c.stress)}</b>
          </div>
        ))}
        {!list.length && <p className="muted-note">No corridor data loaded.</p>}
      </div>
      <p className="muted-note small">{payload?.note}</p>
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
        <h2>Sources & data health</h2>
        <span>{s?.overall_health ?? 'Checking'}</span>
      </div>
      <div className="data-health-summary">
        <div><span>Live</span><strong>{s?.live_count ?? 0}</strong></div>
        <div><span>Degraded</span><strong>{s?.proxy_or_partial_count ?? 0}</strong></div>
        <div><span>Failed</span><strong>{s?.blocked_or_missing_count ?? 0}</strong></div>
        <div><span>Confidence</span><strong>{s?.average_confidence ?? 0}</strong></div>
      </div>
      <div className="data-source-list">
        {shown.map((src) => (
          <div className={`data-source-row status-${src.status}`} key={src.key}>
            <div>
              <strong>{src.label}</strong>
              <span>{src.health}{src.latest_observation ? ` · latest ${src.latest_observation}` : ''} · {src.cadence}</span>
              {mode === 'dense' && <small>{src.note}</small>}
            </div>
            <b>{src.confidence}</b>
          </div>
        ))}
      </div>
      {snapshot && <p className="muted-note small">Snapshot generated {ageText(snapshot.generated_at)}. Every source is free and needs no key.</p>}
    </section>
  );
}

export function StaleBanner({ snapshot, error }: { snapshot: Snapshot | null; error: string | null }) {
  const h = ageHours(snapshot?.generated_at);
  if (error && !snapshot) return <div className="stale-banner bad">Data could not be loaded ({error}).</div>;
  if (h !== null && h > 30) {
    return (
      <div className="stale-banner">
        The data is {ageText(snapshot?.generated_at)} old. Scheduled refreshes run four times a day; check the GitHub Actions
        "Refresh StormDesk data" workflow.
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
            <th>Indicator</th><th>Class</th><th>Value</th><th>Date</th><th>20d chg</th><th>Pctl</th><th>Mom z</th><th>Stress</th><th>Conf</th>
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
