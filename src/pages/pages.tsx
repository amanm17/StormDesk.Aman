import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import type { HealthPayload, Mode, Snapshot } from '../lib/types';
import { GUIDE_CHAPTERS } from '../content/guide';
import { ageText, bandColours, fmt } from '../lib/weather';
import { DataHealthPanel, IndicatorTable } from '../components/widgets';

function Chapter({ n, id, title, children }: { n: number; id: string; title: string; children: ReactNode }) {
  return (
    <section className="guide-chapter" id={`guide-${id}`}>
      <h2><span>{n}</span>{title}</h2>
      {children}
    </section>
  );
}

export function GuidePage({ snapshot }: { snapshot: Snapshot | null }) {
  const m = snapshot?.methodology;
  const f = snapshot?.forecast;
  const ch = (id: string) => GUIDE_CHAPTERS.findIndex((c) => c.id === id) + 1;
  const t = (id: string) => GUIDE_CHAPTERS.find((c) => c.id === id)?.title ?? '';
  const pct = (x: number | undefined) => `${fmt((x ?? 0) * 100)}%`;
  return (
    <div className="guide-page">
      <aside className="guide-toc">
        <span>Contents</span>
        {GUIDE_CHAPTERS.map((c, i) => (
          <a key={c.id} href={`#guide-${c.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(`guide-${c.id}`)?.scrollIntoView({ behavior: 'smooth' }); }}>
            <b>{i + 1}</b>{c.title}
          </a>
        ))}
      </aside>
      <article className="guide-body">
        <header className="guide-head">
          <h1>Guide</h1>
          <p>StormDesk's terms and method, in {GUIDE_CHAPTERS.length} chapters.</p>
        </header>

        <Chapter n={ch('weather')} id="weather" title={t('weather')}>
          <p>Every score in StormDesk is 0–100 stress, read on one six-band scale. "Weather" is shorthand for that band: the global index, asset classes, countries and corridors all use it.</p>
          <table className="guide-table">
            <thead><tr><th>Band</th><th>Score</th><th>Reading</th></tr></thead>
            <tbody>
              {bandColours().map((b) => (
                <tr key={b.label}>
                  <td><b style={{ color: b.colour }}>{b.label}</b></td>
                  <td>{b.low}–{b.high}</td>
                  <td>{m?.weather_bands.find((x) => x.label === b.label)?.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="guide-note">A band is relative to each series' own recent history, not an absolute threshold. A Storm Watch in credit means spreads are high and moving for the last three years, not that a level was crossed.</p>
        </Chapter>

        <Chapter n={ch('score')} id="score" title={t('score')}>
          <pre className="formula">Stress = 0.40·P + 0.25·M + 0.20·V + 0.10·C + 0.05·N</pre>
          <dl className="guide-dl">
            <dt>P</dt><dd>Percentile of today's level in a rolling 756-trading-day (~3y) window. News series use 365 days.</dd>
            <dt>M</dt><dd>20-day change as a z-score against its own history, mapped through the normal CDF. News uses 5 days.</dd>
            <dt>V</dt><dd>Percentile of 20-day realised volatility of daily changes.</dd>
            <dt>C</dt><dd>Contagion: percentile of the mean absolute 60-day correlation across 11 core markets (S&P 500, Nasdaq, UST 10Y, HY and IG spreads, VIX, broad USD, WTI, Brent, EUR, JPY). Common to every indicator.</dd>
            <dt>N</dt><dd>The Macro News class score. Common to every indicator.</dd>
          </dl>
          <table className="guide-table">
            <thead><tr><th>Direction</th><th>Stress when</th><th>Examples</th></tr></thead>
            <tbody>
              <tr><td>Up</td><td>Level high, rising</td><td>VIX, credit spreads, STLFSI, broad USD, USD vs EM currencies</td></tr>
              <tr><td>Down</td><td>Level low, falling</td><td>S&P 500, Nasdaq, 10Y–3M curve, BTC, ETH, news tone</td></tr>
              <tr><td>Either way</td><td>Large 20d move; P ranks |Δ20d|</td><td>UST yields, breakevens, EUR, JPY, GBP, natural gas</td></tr>
            </tbody>
          </table>
          <p className="guide-note">Missing components are dropped and the weights re-normalised. An indicator needs its own P or M to score; C and N alone never produce a score. Weekly series (STLFSI, NFCI) use 4-week momentum and a 156-week window.</p>
        </Chapter>

        <Chapter n={ch('classes')} id="classes" title={t('classes')}>
          <p>A class score is the weighted mean of its members' stress.</p>
          <table className="guide-table">
            <thead><tr><th>Class</th><th>Global weight</th><th>Members</th></tr></thead>
            <tbody>
              {snapshot?.asset_classes.map((a) => (
                <tr key={a.key}>
                  <td>{a.title}</td>
                  <td>{pct(m?.class_weights[a.key])}</td>
                  <td>{a.key === 'trade' ? 'Corridor model (§10); outside the global index' : a.members.map((x) => x.label).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Chapter>

        <Chapter n={ch('global')} id="global" title={t('global')}>
          <pre className="formula">Global = Σ wᵢ·classᵢ / Σ wᵢ  +  6·max(0, C − 60)/40  +  6·breadth</pre>
          <dl className="guide-dl">
            <dt>Contagion adj.</dt><dd>Up to +6 as correlation rises above its 60th percentile.</dd>
            <dt>Breadth</dt><dd>Share of classes at Storm Watch or worse (≥ 61); adds up to +6.</dd>
            <dt>Percentile since 2015</dt><dd>Share of business days since Jan 2015 with a lower global reading.</dd>
          </dl>
          <p className="guide-note">History is computed with the same code, so the chart, the headline and the backtest agree. Reference readings: Mar 2020 ≈ 99, Oct 2022 83, Aug 2024 76, Apr 2025 81; calm spells ≈ 30.</p>
        </Chapter>

        <Chapter n={ch('confidence')} id="confidence" title={t('confidence')}>
          <pre className="formula">Confidence = 0.40·freshness + 0.25·reliability + 0.20·completeness + 0.15·fetch</pre>
          <dl className="guide-dl">
            <dt>Freshness</dt><dd>100 within 4 days of the last observation (10 for weekly), linear to 0 at 21 days (35).</dd>
            <dt>Reliability</dt><dd>{m ? Object.entries(m.source_reliability).map(([k, v]) => `${k} ${v}`).join(' · ') : ''}</dd>
            <dt>Completeness</dt><dd>History length ÷ the percentile window.</dd>
            <dt>Fetch</dt><dd>100 fetched this run · 50 stored copy used.</dd>
            <dt>Thin data</dt><dd>A country with fewer than 3 of 6 World Bank indicators. Its score is pulled halfway to the global reading, confidence is capped at 45 and the globe node is faded.</dd>
          </dl>
          <p className="guide-note">Confidence is reported beside a score; it does not change the score.</p>
        </Chapter>

        <Chapter n={ch('outlook')} id="outlook" title={t('outlook')}>
          <p>A projection of the stress score, not of prices. AR(1) mean reversion fitted on the last 500 days, plus a damped 10-day EWMA slope (0.8 decay per day).</p>
          <dl className="guide-dl">
            <dt>Horizons</dt><dd>1 week (5 business days) and 1 month (20).</dd>
            <dt>Band</dt><dd>80% interval from the AR(1) residuals.</dd>
            <dt>Direction</dt><dd>Worsening if the 1w mean is &gt; 2 pts above today, easing if &gt; 2 below, else steady.</dd>
            <dt>Backtest</dt><dd>{f?.backtest ? `1w mean absolute error ${f.backtest.mae_model} pts vs ${f.backtest.mae_no_change} for no change, ${f.backtest.days} days out of sample.` : 'n/a'}</dd>
          </dl>
        </Chapter>

        <Chapter n={ch('regime')} id="regime" title={t('regime')}>
          <p>Rules on the class scores, checked in order; the first match is the regime.</p>
          <table className="guide-table">
            <thead><tr><th>Regime</th><th>Rule</th></tr></thead>
            <tbody>
              <tr><td>Crisis</td><td>Global ≥ 76 and correlation ≥ 80th pctl</td></tr>
              <tr><td>Liquidity squeeze</td><td>Liquidity ≥ 65 and credit ≥ 60</td></tr>
              <tr><td>Inflation / rates shock</td><td>Bonds ≥ 65 and commodities ≥ 60</td></tr>
              <tr><td>Risk-off</td><td>Equities ≥ 60 and (credit ≥ 55 or global ≥ 55)</td></tr>
              <tr><td>Calm</td><td>Global &lt; 35</td></tr>
              <tr><td>Mixed</td><td>None of the above</td></tr>
            </tbody>
          </table>
        </Chapter>

        <Chapter n={ch('alerts')} id="alerts" title={t('alerts')}>
          <table className="guide-table">
            <thead><tr><th>Alert</th><th>Fires when</th><th>Severity</th></tr></thead>
            <tbody>
              <tr><td>Global band change</td><td>Band differs from 5 business days ago</td><td>High if rising</td></tr>
              <tr><td>Class band change</td><td>Band differs from 5 days ago and moved ≥ 5 pts</td><td>High if rising into ≥ 61</td></tr>
              <tr><td>Extreme reading</td><td>Indicator stress ≥ 80 and P ≥ 90</td><td>High</td></tr>
              <tr><td>Sharp move</td><td>|momentum z| ≥ 2</td><td>High if ≥ 3</td></tr>
              <tr><td>Contagion</td><td>Correlation ≥ 85th pctl</td><td>High</td></tr>
              <tr><td>Event</td><td>Scheduled decision within 3 days</td><td>Medium</td></tr>
              <tr><td>Data</td><td>A source failed or is stale</td><td>Medium</td></tr>
            </tbody>
          </table>
        </Chapter>

        <Chapter n={ch('countries')} id="countries" title={t('countries')}>
          <pre className="formula">Country = 0.50·structural + 0.20·exposure + 0.20·currency + 0.10·news</pre>
          <dl className="guide-dl">
            <dt>Structural</dt><dd>World Bank, most recent year: trade/GDP 13%, CPI inflation 22%, real GDP growth 18% (inverted), current account 20% (deficit = stress), external debt/GNI 13%, reserves in months of imports 14% (inverted). Each scaled linearly between fixed bounds.</dd>
            <dt>Exposure</dt><dd>Mean of the class scores the country is tagged to: oil or food importer → commodities; USD debt → liquidity, FX; crypto adoption → crypto; oil exporter → liquidity; DM → bonds, equities; other EM → FX.</dd>
            <dt>Currency</dt><dd>P/M/V stress of the own currency vs USD (ECB reference rates). Euro-area members use EUR. Without a quoted currency: the regional EM average, else the FX class.</dd>
            <dt>News</dt><dd>GDELT events naming the country: 7-day tone and conflict share vs its own trailing history, as z-scores: 50 + 15·(z_conflict − z_tone), capped 0–100. Needs 30 days of history.</dd>
          </dl>
        </Chapter>

        <Chapter n={ch('corridors')} id="corridors" title={t('corridors')}>
          <pre className="formula">Corridor = 0.30·origin + 0.30·destination + 0.25·channel + 0.15·dependency</pre>
          <dl className="guide-dl">
            <dt>Channel</dt><dd>Energy → commodities · metals → commodities, FX · manufactures → FX, equities · services → liquidity, credit.</dd>
            <dt>Dependency</dt><dd>Corridor goods imports ÷ importer's total goods imports (UN Comtrade, latest full year, HS chapters listed per corridor) × 8, capped at 100. A 12.5% share scores 100. Services corridors use the median corridor.</dd>
            <dt>Trade index</dt><dd>Corridor stresses weighted by log trade value. Shown beside the global index, not inside it.</dd>
          </dl>
        </Chapter>

        <Chapter n={ch('scenarios')} id="scenarios" title={t('scenarios')}>
          <p>A shock is applied as an instant move on the next business day. P, M and V of each shocked series are re-scored with the live engine; C and N are held at today's values.</p>
          <table className="guide-table">
            <thead><tr><th>Shock</th><th>Applied to (β)</th></tr></thead>
            <tbody>
              {snapshot?.scenarios.map((s) => <tr key={s.id}><td>{s.label} ({s.unit})</td><td>{s.note}</td></tr>)}
            </tbody>
          </table>
          <p className="guide-note">Responses are pre-computed on a grid and interpolated. Several shocks add linearly; large combined shocks overstate or understate the joint effect.</p>
        </Chapter>

        <Chapter n={ch('events')} id="events" title={t('events')}>
          <p>Pressure = importance × decay by days to the event: 1.0 on the day, 0.9 at 1d, 0.72 at ≤ 3d, 0.48 at ≤ 7d, 0.26 at ≤ 14d, 0.10 beyond. Event score = sum of the next 8 ÷ min(4, count), capped at 100. It measures calendar load, not the likely outcome.</p>
          <p className="guide-note">Fed, ECB, BoE and RBI dates come from their official calendars. {snapshot?.event_risk.reviewed_on ? `Last reviewed ${snapshot.event_risk.reviewed_on}.` : ''}</p>
        </Chapter>

        <Chapter n={ch('data')} id="data" title={t('data')}>
          <dl className="guide-dl">
            <dt>Refresh</dt><dd>06:47, 12:47, 18:47 and 00:47 IST via GitHub Actions. Each series' history is stored and extended every run.</dd>
            <dt>Statuses</dt><dd>Live: fetched this run · Partly live: some series from storage · Stored: fetch failed, last values used · Stale: older than its cadence · Unavailable: no data.</dd>
            <dt>Gold</dt><dd>PAX Gold (PAXG), a token backed 1:1 by London Good Delivery gold. LBMA fixes are no longer free.</dd>
            <dt>News</dt><dd>GDELT 1.0 daily event files. Stress share: % of unique source URLs containing stress terms (inflation, recession, default, layoffs, tariff…). Tone: article-weighted average tone. Conflict: % of events in CAMEO quad class 4.</dd>
            <dt>History limits</dt><dd>ICE BofA spreads: 3 years free on FRED. CoinGecko: 365 days, extended by storage. GDELT: 90-day backfill.</dd>
            <dt>Lags</dt><dd>FRED oil ≈ 1 week; credit spreads 1 day; World Bank annual; Comtrade annual.</dd>
            <dt>Tape colours</dt><dd>Red: the move adds stress given the series' direction. Green: it eases stress.</dd>
            <dt>Day / Night</dt><dd>The globe's terminator is the real one at the time you load the page, updated every minute. The theme changes the interface only, never the data.</dd>
          </dl>
        </Chapter>
      </article>
    </div>
  );
}

const REGISTRY = [
  { name: 'FRED', url: 'https://fred.stlouisfed.org/', what: 'UST yields, curve, breakevens, ICE BofA spreads, S&P 500, Nasdaq, VIX, STLFSI, NFCI, broad USD, WTI, Brent, Henry Hub, OVX', terms: 'Public CSV. S&P and ICE BofA series remain the owners’ copyright.' },
  { name: 'Frankfurter (ECB)', url: 'https://frankfurter.dev/', what: '30 currencies vs USD, daily', terms: 'Open source, no key' },
  { name: 'CoinGecko', url: 'https://www.coingecko.com/en/api', what: 'BTC, ETH, PAXG', terms: 'Public API; attribution to CoinGecko' },
  { name: 'GDELT', url: 'https://www.gdeltproject.org/', what: 'Daily event files: tone, conflict, stress share, per country', terms: 'Open; cite the GDELT Project' },
  { name: 'World Bank', url: 'https://data.worldbank.org/', what: '6 structural indicators, ~250 economies', terms: 'CC BY 4.0' },
  { name: 'UN Comtrade', url: 'https://comtradeplus.un.org/', what: 'Corridor goods imports', terms: 'Public preview endpoint, no key' },
  { name: 'Central banks', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm', what: 'Fed, ECB, BoE, RBI decision dates', terms: 'Official calendars, entered by hand' },
];

export function SourcesPage({ health, snapshot, mode }: { health: HealthPayload | null; snapshot: Snapshot | null; mode: Mode }) {
  return (
    <section className="focus-page document-page sources-page">
      <div className="focus-page-copy">
        <h2>Sources</h2>
        <p>Checked {ageText(health?.generated_at)} · all free, no keys</p>
      </div>
      <div className="sources-layout">
        <DataHealthPanel health={health} mode="dense" snapshot={snapshot} />
        <section className="panel">
          <div className="panel-title"><h2>Registry</h2></div>
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
          <div className="panel-title"><h2>Indicators</h2><span>{snapshot.indicators.filter((i) => i.available).length}</span></div>
          <IndicatorTable indicators={snapshot.indicators} />
          {mode === 'dense' && (snapshot.source_status.errors as string[] | undefined)?.length ? (
            <details className="muted-note"><summary>Last-run fetch messages</summary><ul>{(snapshot.source_status.errors as string[]).map((e) => <li key={e}>{e}</li>)}</ul></details>
          ) : null}
        </section>
      )}
    </section>
  );
}

