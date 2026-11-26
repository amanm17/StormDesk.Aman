import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { BookOpen, ChevronsLeft, ChevronsRight, CloudLightning, Database, FlaskConical, Gauge, Globe2, LineChart, Moon, RefreshCw, Route, Sun } from 'lucide-react';
import { useStormData } from './lib/data';
import type { Mode, Page, View } from './lib/types';
import { CLASS_ORDER, setColourTheme, signed, stressColour, updatedText, type Theme } from './lib/weather';
import CommandSearch from './components/CommandSearch';
import ScenarioLab from './components/ScenarioLab';
import { AlertFeed, DataHealthPanel, EventRiskPanel, Headline, IndicatorTable, StaleBanner, StressTile, TradeCorridorsPanel } from './components/widgets';
import { GuidePage, SourcesPage } from './pages/pages';

const GlobePanel = lazy(() => import('./components/GlobePanel'));
const ChartStudio = lazy(() => import('./components/ChartStudio'));

const Loading = () => <section className="panel"><p className="muted-note">Loading…</p></section>;

function initialTheme(): Theme {
  const saved = storageGet('sd-theme');
  if (saved === 'day' || saved === 'night') return saved;
  const h = new Date().getHours();
  return h >= 6 && h < 18 ? 'day' : 'night';
}

export default function App() {
  const { snapshot, countries, corridors, health, error, reload } = useStormData();
  const [mode, setMode] = useState<Mode>(() => (storageGet('sd-mode') as Mode) || 'clean');
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [rail, setRail] = useState<boolean>(() => storageGet('sd-rail') !== 'collapsed');
  const [view, setView] = useState<View>('dashboard');
  const [page, setPage] = useState<Page>('workbench');
  const [focusCountry, setFocusCountry] = useState<string | null>(null);
  const [focusCorridor, setFocusCorridor] = useState<string | null>(null);
  const [focusIndicator, setFocusIndicator] = useState<string | null>(null);

  setColourTheme(theme);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    storageSet('sd-theme', theme);
  }, [theme]);
  useEffect(() => { storageSet('sd-mode', mode); }, [mode]);
  useEffect(() => { storageSet('sd-rail', rail ? 'open' : 'collapsed'); }, [rail]);
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
  const nav: { key: View | Page; label: string; kind: 'view' | 'page'; icon: JSX.Element }[] = [
    { key: 'dashboard', label: 'Dashboard', kind: 'view', icon: <Gauge size={17} /> },
    { key: 'globe', label: 'Globe', kind: 'view', icon: <Globe2 size={17} /> },
    { key: 'trade', label: 'Trade', kind: 'view', icon: <Route size={17} /> },
    { key: 'scenario', label: 'Scenario Lab', kind: 'view', icon: <FlaskConical size={17} /> },
    { key: 'charts', label: 'Charts', kind: 'view', icon: <LineChart size={17} /> },
    { key: 'guide', label: 'Guide', kind: 'page', icon: <BookOpen size={17} /> },
    { key: 'sources', label: 'Sources', kind: 'page', icon: <Database size={17} /> },
  ];

  return (
    <main className={`app-shell sd-shell ${mode === 'dense' ? 'dense-mode' : 'clean-mode'} theme-${theme} ${rail ? '' : 'rail-collapsed'}`}>
      <header className="sd-top">
        <button className="sd-brand" onClick={() => goView('dashboard')} aria-label="StormDesk by Aman, dashboard">
          <CloudLightning size={22} />
          <div>
            <strong>StormDesk <em>by Aman</em></strong>
            <span>{snapshot ? updatedText(snapshot.generated_at) : 'Loading'}</span>
          </div>
        </button>
        <div className="sd-top-right">
          <CommandSearch snapshot={snapshot} countries={countries} corridors={corridors} health={health} goView={goView} goPage={goPage}
            focusCountry={setFocusCountry} focusCorridor={setFocusCorridor} focusIndicator={setFocusIndicator} />
          <button className="icon-button" onClick={reload} title="Reload data" aria-label="Reload data"><RefreshCw size={15} /></button>
          <button className={`sd-daynight ${theme}`} onClick={() => setTheme(theme === 'day' ? 'night' : 'day')}
            aria-label={theme === 'day' ? 'Switch to After Dark' : 'Switch to Light'} title={theme === 'day' ? 'After Dark' : 'Light'}>
            <span className="sd-dn-track"><Sun size={13} className="sd-dn-sun" /><Moon size={13} className="sd-dn-moon" /><i className="sd-dn-knob" /></span>
          </button>
          <div className={`mode-switch ${mode}`} title="Clean / Dense">
            <div className="mode-glider" />
            <button onClick={() => setMode('clean')} className={mode === 'clean' ? 'active' : ''} aria-label="Clean view">C</button>
            <button onClick={() => setMode('dense')} className={mode === 'dense' ? 'active' : ''} aria-label="Dense view">D</button>
          </div>
        </div>
      </header>

      <nav className="sd-rail" aria-label="Primary">
        {nav.map((n) => {
          const active = n.kind === 'view' ? page === 'workbench' && view === n.key : page === n.key;
          return (
            <button key={n.key} className={active ? 'active' : ''} title={n.label} aria-current={active ? 'page' : undefined}
              onClick={() => (n.kind === 'view' ? goView(n.key as View) : goPage(n.key as Page))}>
              {n.icon}<span>{n.label}</span>
            </button>
          );
        })}
        <button className="sd-rail-toggle" onClick={() => setRail(!rail)} aria-label={rail ? 'Collapse menu' : 'Expand menu'}>
          {rail ? <ChevronsLeft size={16} /> : <ChevronsRight size={16} />}
        </button>
      </nav>

      <div className="sd-main">
        <StaleBanner snapshot={snapshot} error={error} />

        <section className="market-tape">
          {(snapshot?.market_tape ?? []).map((t) => (
            <div className="tape-item" key={t.key} title={`${t.label} · ${t.source} · ${t.date}`}>
              <span>{TAPE_LABELS[t.key] ?? t.label}</span>
              <strong>{t.display}</strong>
              <em className={tapeClass(t.change, t.direction)}>
                {t.change === null ? t.source : signed(t.change, t.change_unit === '%' ? 1 : 2, t.change_unit === '%' ? '%' : '')}
              </em>
            </div>
          ))}
        </section>

        {page === 'workbench' && view === 'dashboard' && (
          <>
            <Headline snapshot={snapshot} mode={mode} />
            <div className="sd-dash">
              <div className="sd-col-main">
                <Suspense fallback={<Loading />}>
                  <GlobePanel mode={mode} theme={theme} countries={countryList} corridors={corridorList} focusedCountry={focusCountry} compact />
                </Suspense>
                <Suspense fallback={<Loading />}>
                  <ChartStudio mode={mode} theme={theme} snapshot={snapshot} initialIndicator={focusIndicator} />
                </Suspense>
                <div className="sd-pair">
                  <EventRiskPanel snapshot={snapshot} />
                  <DataHealthPanel health={health} mode={mode} snapshot={snapshot} />
                </div>
              </div>
              <aside className="sd-col-side">
                <section className="panel signal-panel">
                  <div className="panel-title"><h2>Asset classes</h2><span>{snapshot ? `conf ${snapshot.global.confidence}%` : ''}</span></div>
                  <div className="tile-grid">
                    {classes.map((c) => <StressTile key={c.key} cls={c} mode={mode} indicators={snapshot?.indicators ?? []} />)}
                  </div>
                </section>
                <AlertFeed alerts={snapshot?.alerts ?? []} mode={mode} />
                <section className="panel trade-panel">
                  <div className="panel-title"><h2>Trade corridors</h2><span>{corridors?.trade_score ?? ''}</span></div>
                  {corridorList.slice(0, 5).map((c) => (
                    <button className="trade-row" key={c.id} onClick={() => { setFocusCorridor(`${c.from_name} ${c.to_name} ${c.commodity}`); goView('trade'); }}>
                      <span>{c.from_name} → {c.to_name} <small>{c.commodity}</small></span>
                      <b style={{ color: stressColour(c.stress) }}>{Math.round(c.stress)}</b>
                    </button>
                  ))}
                </section>
              </aside>
            </div>
          </>
        )}

        {page === 'workbench' && view === 'globe' && (
          <Suspense fallback={<Loading />}>
            <div className="sd-globe-page">
              <GlobePanel mode={mode} theme={theme} countries={countryList} corridors={corridorList} focusedCountry={focusCountry} />
            </div>
          </Suspense>
        )}

        {page === 'workbench' && view === 'trade' && (
          <div className="sd-dash">
            <div className="sd-col-main">
              <TradeCorridorsPanel payload={corridors} mode={mode} focusedQuery={focusCorridor} />
            </div>
            <aside className="sd-col-side">
              <Suspense fallback={<Loading />}>
                <GlobePanel mode={mode} theme={theme} countries={countryList} corridors={corridorList} focusedCountry={focusCountry} compact />
              </Suspense>
            </aside>
          </div>
        )}

        {page === 'workbench' && view === 'scenario' && <ScenarioLab snapshot={snapshot} />}

        {page === 'workbench' && view === 'charts' && (
          <section className="focus-page charts-page">
            <Suspense fallback={<Loading />}>
              <ChartStudio mode="dense" theme={theme} snapshot={snapshot} initialIndicator={focusIndicator} />
            </Suspense>
            {snapshot && (
              <section className="panel">
                <div className="panel-title"><h2>Indicators</h2><span>{snapshot.indicators.filter((i) => i.available).length}</span></div>
                <IndicatorTable indicators={snapshot.indicators} selected={focusIndicator} onPick={(k) => { setFocusIndicator(k); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />
              </section>
            )}
          </section>
        )}

        {page === 'guide' && <GuidePage snapshot={snapshot} />}
        {page === 'sources' && <SourcesPage health={health} snapshot={snapshot} mode={mode} />}

        <footer>
          <span><b>StormDesk by Aman</b> · FRED, ECB, CoinGecko, GDELT, World Bank, UN Comtrade · not financial advice</span>
        </footer>
      </div>
    </main>
  );
}

const TAPE_LABELS: Record<string, string> = {
  us10y: 'UST 10Y', curve10y3m: '10Y–3M', hy_oas: 'HY OAS', spx: 'S&P 500', vix: 'VIX', usd_broad: 'USD broad',
  wti: 'WTI', gold: 'Gold', usdgbp: 'USD/GBP', usdinr: 'USD/INR', btc: 'BTC', eth: 'ETH',
};

function tapeClass(change: number | null, direction?: string) {
  if (change === null || change === 0 || !direction || direction === 'abs') return '';
  const stressUp = direction === 'up' ? change > 0 : change < 0;
  return stressUp ? 'up' : 'down';
}

function storageGet(k: string) {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function storageSet(k: string, v: string) {
  try { window.localStorage.setItem(k, v); } catch { /* private mode */ }
}
