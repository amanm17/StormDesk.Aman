import { useState } from 'react';
import { BookOpen, Database, ExternalLink, Sigma, Sparkles } from 'lucide-react';
import type { HealthPayload, Mode, Snapshot } from '../lib/types';
import { concepts } from '../content/concepts';
import { BANDS, ageText, fmt, stressColour } from '../lib/weather';
import { DataHealthPanel, IndicatorTable } from '../components/widgets';

export function LearnPage({ snapshot }: { snapshot: Snapshot | null }) {
  const [open, setOpen] = useState<string | null>(null);
  const g = snapshot?.global;
  return (
    <section className="learn-section learn-focus document-page">
      <div className="learn-intro">
        <div className="panel-title"><BookOpen size={18} /><h2>How to read the weather</h2></div>
        <p>
          StormDesk turns about thirty public market and news signals into one question: how stressed is the financial
          system right now, and is it getting worse? It does not predict prices and it is not investment advice.
        </p>
      </div>
      <div className="guide-steps">
        <article><b>1</b><div><h3>Read the headline</h3><p>The Global Financial Weather Index runs from 0 to 100.{g ? ` Today it is ${Math.round(g.score)}, ${g.weather}, higher than ${fmt(g.percentile_since_2015)}% of days since 2015.` : ''}</p></div></article>
        <article><b>2</b><div><h3>Find where the pressure is</h3><p>Asset-class tiles show which markets drive it. A score is high when a signal is unusually high for the last three years, moving fast, and volatile.</p></div></article>
        <article><b>3</b><div><h3>Check if it is spreading</h3><p>The contagion reading rises when unrelated markets start moving together, the classic sign of a systemic episode.</p></div></article>
        <article><b>4</b><div><h3>Look ahead, carefully</h3><p>The outlook projects the stress level one week and one month out, with a range. Wide ranges mean low certainty.</p></div></article>
        <article><b>5</b><div><h3>Check the confidence</h3><p>Every score carries a confidence based on how fresh, complete and reliable its data is. Faded markers on the globe mean thin data.</p></div></article>
      </div>
      <div className="band-legend">
        {BANDS.map((b) => (
          <div key={b.label} style={{ borderColor: b.colour }}>
            <strong style={{ color: b.colour }}>{b.label}</strong><span>{b.low}–{b.high}</span>
            <small>{snapshot?.methodology.weather_bands.find((x) => x.label === b.label)?.meaning}</small>
          </div>
        ))}
      </div>
      <div className="concept-grid knowledge-grid">
        {concepts.map((c) => {
          const isOpen = open === c.title;
          return (
            <article key={c.title} className={isOpen ? 'concept-card open' : 'concept-card'} onClick={() => setOpen(isOpen ? null : c.title)}>
              <Sparkles size={16} />
              <h3>{c.title}</h3>
              <p>{c.short}</p>
              {isOpen && (
                <div className="concept-expanded">
                  <p>{c.long}</p>
                  <div className="reference-links">
                    {c.refs.map(([label, url]) => <a key={url} href={url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{label}</a>)}
                  </div>
                </div>
              )}
              <button className="expand-hint">{isOpen ? 'Collapse' : 'Expand'}</button>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function MethodologyPage({ snapshot }: { snapshot: Snapshot | null }) {
  const m = snapshot?.methodology;
  const f = snapshot?.forecast;
  return (
    <section className="focus-page document-page methodology-page">
      <div className="focus-page-copy">
        <span className="eyebrow"><Sigma size={14} /> Methodology</span>
        <h2>How every number is made</h2>
        <p>All inputs are free, public and keyless. The pipeline runs four times a day in GitHub Actions, stores each series' history, and publishes static JSON that this site reads. Nothing is hand-entered except the central-bank calendar.</p>
      </div>
      <div className="method-grid">
        <article className="panel">
          <h3>1 · Indicator stress (0–100)</h3>
          <pre className="formula">Stress = 0.40·P + 0.25·M + 0.20·V + 0.10·C + 0.05·N</pre>
          <ul>
            <li><b>P · percentile</b>: where today's level sits in its last ~3 years (756 trading days). For indicators where any big move is stress (yields, major FX), the size of the 20-day move is ranked instead.</li>
            <li><b>M · momentum</b>: the 20-day change as a z-score against its own history, mapped to 0–100 with the normal curve.</li>
            <li><b>V · volatility</b>: percentile of 20-day realised volatility.</li>
            <li><b>C · contagion</b>: percentile of the average absolute 60-day correlation across eleven core markets.</li>
            <li><b>N · news</b>: the GDELT news-pressure score.</li>
          </ul>
          <p className="muted-note">Each indicator declares a direction: higher is stress (VIX, spreads), lower is stress (equities, the yield curve), or large moves either way. Missing parts are dropped and the weights re-normalised; an indicator needs its own P or M to score at all.</p>
        </article>
        <article className="panel">
          <h3>2 · Asset classes and the global index</h3>
          <table className="indicator-table">
            <thead><tr><th>Class</th><th>Weight in global</th><th>Today</th></tr></thead>
            <tbody>
              {snapshot?.asset_classes.map((a) => (
                <tr key={a.key}><td>{a.title}</td><td>{fmt((m?.class_weights[a.key] ?? 0) * 100)}%</td><td style={{ color: stressColour(a.score) }}>{Math.round(a.score)} {a.weather}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted-note">{m?.global_formula}. Trade weather is built from annual Comtrade data and is shown beside the index, not inside it.</p>
        </article>
        <article className="panel">
          <h3>3 · Confidence</h3>
          <pre className="formula">Confidence = 0.40·freshness + 0.25·reliability + 0.20·completeness + 0.15·fetch</pre>
          <ul>
            <li><b>Freshness</b>: full marks within 4 days (10 for weekly data), falling to zero at 21 days (35).</li>
            <li><b>Reliability</b>: {m ? Object.entries(m.source_reliability).map(([k, v]) => `${k} ${v}`).join(', ') : ''}.</li>
            <li><b>Completeness</b>: history length against the 3-year window.</li>
            <li><b>Fetch</b>: 100 if fetched live this run, 50 if the stored copy was used.</li>
          </ul>
        </article>
        <article className="panel">
          <h3>4 · Forecast, regime, alerts</h3>
          <ul>
            <li><b>Forecast</b>: {f?.method}. 80% bands from the model's residuals. {f?.backtest ? `Out-of-sample 1-week error ${f.backtest.mae_model} points vs ${f.backtest.mae_no_change} for "no change" over ${f.backtest.days} days.` : ''}</li>
            <li><b>Regime</b>: transparent rules on the class scores (Crisis, Liquidity squeeze, Inflation / rates shock, Risk-off, Calm, Mixed). A hidden-Markov model is the planned upgrade.</li>
            <li><b>Alerts</b>: fire on band changes, top-decile readings, 2-sigma moves, contagion spikes, imminent events and stale sources.</li>
          </ul>
        </article>
        <article className="panel">
          <h3>5 · Countries and trade corridors</h3>
          <ul>
            <li><b>Country</b> = 50% structural (World Bank: trade openness, inflation, growth, current account, external debt, reserves) + 20% exposure to stressed asset classes + 20% own-currency stress vs USD + 10% news tone and conflict (GDELT). Countries with fewer than three World Bank indicators are flagged as thin data.</li>
            <li><b>Corridor</b> = 0.30 origin + 0.30 destination + 0.25 market channel + 0.15 import dependency, where dependency is the corridor's share of the importer's goods imports from UN Comtrade.</li>
          </ul>
        </article>
        <article className="panel">
          <h3>6 · Backtest and limits</h3>
          <p>On history since 2015 the index reads about 99 in March 2020, 83 in the October 2022 rate shock, 76 in the August 2024 carry unwind and 81 in the April 2025 tariff shock, against roughly 30 in calm spells (2017, mid-2021). See Charts → Since 2015.</p>
          <ul>
            <li>Free data lags: FRED oil prices trail by about a week, credit spreads by a day, World Bank data is annual.</li>
            <li>US credit spreads (ICE BofA) are only free for the last three years; crypto history starts with the 365 days CoinGecko provides and grows from there.</li>
            <li>Proxies are imperfect: gold uses the PAX Gold token, news uses link keywords and GDELT tone.</li>
          </ul>
        </article>
      </div>
    </section>
  );
}

const REGISTRY = [
  { name: 'FRED (St. Louis Fed)', url: 'https://fred.stlouisfed.org/', what: 'Treasury yields, curve, breakevens, ICE BofA credit spreads, S&P 500, Nasdaq, VIX, financial-stress indices, broad dollar, oil, gas', terms: 'Public CSV download, no key. Some series (S&P, ICE BofA) carry the owner’s copyright; shown for analysis with attribution.' },
  { name: 'Frankfurter', url: 'https://frankfurter.dev/', what: 'ECB reference exchange rates for ~30 currencies since 1999', terms: 'Free, open source, no key.' },
  { name: 'CoinGecko', url: 'https://www.coingecko.com/en/api', what: 'Bitcoin, Ether and PAX Gold (gold proxy) daily prices', terms: 'Free public API with rate limits; attribution to CoinGecko.' },
  { name: 'GDELT Project', url: 'https://www.gdeltproject.org/', what: 'Daily global event files: news tone, conflict share, stress-keyword share, per-country news stress', terms: 'Free and open; cite the GDELT Project.' },
  { name: 'World Bank', url: 'https://data.worldbank.org/', what: 'Structural indicators for ~250 economies', terms: 'CC BY 4.0.' },
  { name: 'UN Comtrade', url: 'https://comtradeplus.un.org/', what: 'Bilateral goods trade values for the corridors', terms: 'Free public preview endpoint (up to 500 records a call, no key).' },
  { name: 'Central banks', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', what: 'Fed, ECB, Bank of England and RBI meeting calendars', terms: 'Official public schedules, entered by hand and reviewed twice a year.' },
];

export function SourcesPage({ health, snapshot, mode }: { health: HealthPayload | null; snapshot: Snapshot | null; mode: Mode }) {
  return (
    <section className="focus-page document-page sources-page">
      <div className="focus-page-copy">
        <span className="eyebrow"><Database size={14} /> Source lineage</span>
        <h2>Open data, visible confidence</h2>
        <p>Every source is free with no subscription and no API key. Health is judged from content: what was fetched live, what fell back to stored history and how old the newest observation is. Last check {ageText(health?.generated_at)}.</p>
      </div>
      <div className="sources-layout">
        <DataHealthPanel health={health} mode="dense" snapshot={snapshot} />
        <section className="panel">
          <div className="panel-title"><Database size={17} /><h2>Source registry</h2></div>
          <div className="source-registry">
            {REGISTRY.map((r) => (
              <article key={r.name}>
                <a href={r.url} target="_blank" rel="noreferrer"><strong>{r.name}</strong> <ExternalLink size={12} /></a>
                <p>{r.what}</p>
                <small>{r.terms}</small>
              </article>
            ))}
          </div>
        </section>
      </div>
      {snapshot && (
        <section className="panel">
          <div className="panel-title"><Sigma size={17} /><h2>Every indicator</h2><span>{snapshot.indicators.filter((i) => i.available).length} live series</span></div>
          <IndicatorTable indicators={snapshot.indicators} />
          {mode === 'dense' && (snapshot.source_status.errors as string[] | undefined)?.length ? (
            <details className="muted-note"><summary>Fetch messages from the last run</summary><ul>{(snapshot.source_status.errors as string[]).map((e) => <li key={e}>{e}</li>)}</ul></details>
          ) : null}
        </section>
      )}
    </section>
  );
}
