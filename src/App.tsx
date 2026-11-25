import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Activity, CloudLightning, Layers3, RefreshCw, Waves } from 'lucide-react';
import { useStormData } from './lib/data';
import type { Mode, Page, View } from './lib/types';
import { CLASS_ORDER, signed, stressColour } from './lib/weather';
import CommandSearch from './components/CommandSearch';
import ScenarioLab from './components/ScenarioLab';
import { AlertFeed, DataHealthPanel, EventRiskPanel, HeroPanel, IndicatorTable, StaleBanner, StressTile, TradeCorridorsPanel } from './components/widgets';
import { LearnPage, MethodologyPage, SourcesPage } from './pages/pages';

const GlobePanel = lazy(() => import('./components/GlobePanel'));
const ChartStudio = lazy(() => import('./components/ChartStudio'));

const Loading = ({ label }: { label: string }) => <section className="panel"><p className="muted-note">Loading {label}…</p></section>;

export default function App() {
  const { snapshot, countries, corridors, health, error, reload } = useStormData();
  const [mode, setMode] = useState<Mode>(() => (localStorageGet('sd-mode') as Mode) || 'clean');
  const [view, setView] = useState<View>('dashboard');
  const [page, setPage] = useState<Page>('workbench');
  const [focusCountry, setFocusCountry] = useState<string | null>(null);
  const [focusCorridor, setFocusCorridor] = useState<string | null>(null);
  const [focusIndicator, setFocusIndicator] = useState<string | null>(null);

  useEffect(() => { localStorageSet('sd-mode', mode); }, [mode]);
  useEffect(() => {
    document.title = snapshot ? `${Math.round(snapshot.global.score)} ${snapshot.global.weather} · StormDesk by Aman` : 'StormDesk by Aman';
  }, [snapshot]);
  useEffect(() => {
    if (view === 'trade' && focusCorridor) {
      const t = window.setTimeout(() => document.getElementById('trade-corridors-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
      return () => window.clearTimeout(t);
    }
  }, [view, focusCorridor]);

  const goView = useCallback((v: View) => { setPage('workbench'); setView(v); window.scrollTo({ top: 0 }); }, []);
  const goPage = useCallback((p: Page) => { setPage(p); window.scrollTo({ top: 0 }); }, []);

  const classes = snapshot ? CLASS_ORDER.map((k) => snapshot.asset_classes.find((a) => a.key === k)).filter((a): a is NonNullable<typeof a> => Boolean(a)) : [];
  const countryList = countries?.countries ?? [];
  const corridorList = corridors?.corridors ?? [];
  const nav: [View | Page, string, 'view' | 'page'][] = [
    ['dashboard', 'Dashboard', 'view'], ['globe', 'Globe', 'view'], ['trade', 'Trade Weather', 'view'], ['scenario', 'Scenario Lab', 'view'],
    ['charts', 'Charts', 'view'], ['learn', 'Learn', 'page'], ['methodology', 'Methodology', 'page'], ['sources', 'Sources', 'page'],
  ];

  return (
    <main className={`app-shell ${mode === 'dense' ? 'dense-mode' : 'clean-mode'}`}>
      <header className="topbar v4-topbar">
        <button className="brand brand-button" onClick={() => goView('dashboard')} aria-label="StormDesk by Aman, go to dashboard">
          <CloudLightning size={22} />
          <div>
            <strong>StormDesk <em className="byline">by Aman</em></strong>
            <span>Financial weather radar</span>
          </div>
        </button>
        <nav className="section-tabs inline-tabs" aria-label="Primary navigation">
          {nav.map(([key, label, kind]) => {
            const active = kind === 'view' ? page === 'workbench' && view === key : page === key;
            return (
              <button key={key} className={active ? (kind === 'page' ? 'active doc-active' : 'active') : kind === 'page' ? 'doc-tab' : ''}
                onClick={() => (kind === 'view' ? goView(key as View) : goPage(key as Page))}>{label}</button>
            );
          })}
        </nav>
        <div className="topbar-right">
          <CommandSearch snapshot={snapshot} countries={countries} corridors={corridors} health={health} goView={goView} goPage={goPage}
            focusCountry={setFocusCountry} focusCorridor={setFocusCorridor} focusIndicator={setFocusIndicator} />
          <button className="icon-button" onClick={reload} title="Reload data"><RefreshCw size={15} /></button>
          <div className={`mode-switch ${mode}`} title="Clean or Dense view">
            <div className="mode-glider" />
            <button onClick={() => setMode('clean')} className={mode === 'clean' ? 'active' : ''}>C</button>
            <button onClick={() => setMode('dense')} className={mode === 'dense' ? 'active' : ''}>D</button>
          </div>
        </div>
      </header>

      <StaleBanner snapshot={snapshot} error={error} />

      <section className="market-tape">
        {(snapshot?.market_tape ?? []).map((t) => (
          <div className="tape-item" key={t.key} title={`${t.label} · ${t.source} · ${t.date}`}>
            <span>{t.label.replace(' volatility index', '').replace('US 10Y Treasury yield', 'US 10Y').replace('10Y minus 3M curve', '10Y–3M').replace('US high-yield spread', 'HY spread').replace('Broad US dollar index', 'USD broad').replace(' crude oil', '')}</span>
            <strong>{t.display}</strong>
            <em className={tapeClass(t.change, t.direction)} title="red = the move adds stress, green = it eases stress">
              {t.change === null ? t.source : signed(t.change, t.change_unit === '%' ? 1 : 2, t.change_unit === '%' ? '%' : '')}
            </em>
          </div>
        ))}
        {!snapshot && <div className="tape-item"><span>Loading</span><strong>…</strong></div>}
      </section>

      {page === 'workbench' && (view === 'dashboard' || view === 'globe' || view === 'trade') && (
        <div className={`dashboard-grid view-${view}`}>
          <aside className={`left-rail ${view !== 'dashboard' ? 'rail-muted' : ''}`}>
            <HeroPanel snapshot={snapshot} mode={mode} />
            <AlertFeed alerts={snapshot?.alerts ?? []} mode={mode} />
          </aside>
          <section className={`centre-stage ${view === 'globe' ? 'focus-globe' : ''}`}>
            {view === 'trade' && <TradeCorridorsPanel payload={corridors} mode={mode} focusedQuery={focusCorridor} />}
            <Suspense fallback={<Loading label="globe" />}>
              <GlobePanel mode={mode} countries={countryList} corridors={corridorList} focusedCountry={focusCountry} />
            </Suspense>
            {view === 'dashboard' && (
              <Suspense fallback={<Loading label="charts" />}>
                <ChartStudio mode={mode} snapshot={snapshot} initialIndicator={focusIndicator} />
              </Suspense>
            )}
            <EventRiskPanel snapshot={snapshot} />
            {view !== 'trade' && <TradeCorridorsPanel payload={corridors} mode={mode} focusedQuery={focusCorridor} />}
            <DataHealthPanel health={health} mode={mode} snapshot={snapshot} />
          </section>
          <aside className={`right-rail ${view === 'globe' ? 'rail-muted' : ''}`}>
            <section className="panel signal-panel">
              <div className="panel-title"><Activity size={17} /><h2>Asset weather</h2><span>{snapshot ? `confidence ${snapshot.global.confidence}%` : ''}</span></div>
              <div className="tile-grid">
                {classes.map((c) => <StressTile key={c.key} cls={c} mode={mode} indicators={snapshot?.indicators ?? []} />)}
              </div>
            </section>
            <section className="panel trade-panel">
              <div className="panel-title"><Layers3 size={17} /><h2>Trade weather</h2><span>{corridors?.trade_score ?? ''}</span></div>
              <p>Corridor stress combines both countries' weather, the market channel the goods are exposed to, and the importer's dependency from UN Comtrade.</p>
              {corridorList.slice(0, 5).map((c) => (
                <button className="trade-row" key={c.id} onClick={() => { setFocusCorridor(`${c.from_name} ${c.to_name} ${c.commodity}`); goView('trade'); }}>
                  <span>{c.from_name} → {c.to_name} <small>{c.commodity}</small></span>
                  <b style={{ color: stressColour(c.stress) }}>{Math.round(c.stress)}</b>
                </button>
              ))}
            </section>
          </aside>
        </div>
      )}

      {page === 'workbench' && view === 'scenario' && <ScenarioLab snapshot={snapshot} />}

      {page === 'workbench' && view === 'charts' && (
        <section className="focus-page charts-page">
          <Suspense fallback={<Loading label="charts" />}>
            <ChartStudio mode="dense" snapshot={snapshot} initialIndicator={focusIndicator} />
          </Suspense>
          {snapshot && (
            <section className="panel">
              <div className="panel-title"><Activity size={17} /><h2>Indicators</h2><span>click a row to chart it</span></div>
              <IndicatorTable indicators={snapshot.indicators} selected={focusIndicator} onPick={(k) => { setFocusIndicator(k); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
            </section>
          )}
        </section>
      )}

      {page === 'learn' && <LearnPage snapshot={snapshot} />}
      {page === 'methodology' && <MethodologyPage snapshot={snapshot} />}
      {page === 'sources' && <SourcesPage health={health} snapshot={snapshot} mode={mode} />}

      <footer>
        <Waves size={15} />
        <span>
          <b>StormDesk by Aman</b> · built by Aman Mishra · open data only (FRED, ECB via Frankfurter, CoinGecko, GDELT, World Bank, UN Comtrade) ·
          refreshed four times a day · educational and analytical use only, not financial advice.
        </span>
      </footer>
    </main>
  );
}

function tapeClass(change: number | null, direction?: string) {
  if (change === null || change === 0 || !direction || direction === 'abs') return '';
  const stressUp = direction === 'up' ? change > 0 : change < 0;
  return stressUp ? 'up' : 'down';
}

function localStorageGet(k: string) {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function localStorageSet(k: string, v: string) {
  try { window.localStorage.setItem(k, v); } catch { /* private mode */ }
}
