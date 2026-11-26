# StormDesk by Aman

By Aman Mishra.

A free, open-data **financial weather radar**. StormDesk turns about thirty public market and news
signals into one 0–100 Global Financial Weather Index, scores nine asset classes, rates 250 countries
and 14 trade corridors, projects stress a week and a month ahead, and lets you stress-test shocks.

> Fully free. No paid API, no API key, no subscription. Data refreshes four times a day in GitHub
> Actions and deploys on Cloudflare's free plan, the same setup as HStat.India.

| Weather | Score | Meaning |
|---|---|---|
| Clear | 0–20 | Normal conditions |
| Cloudy | 21–40 | Mild pressure |
| Rain | 41–60 | Visible stress in one or more areas |
| Storm Watch | 61–75 | Elevated and may be spreading |
| Severe Storm | 76–90 | Multiple systems under significant pressure |
| Hurricane | 91–100 | Extreme, systemic conditions possible |

---

## How it works

```
GitHub Actions (4× a day)
  └─ python -m pipeline.run
       ├─ fetch    FRED CSV · Frankfurter (ECB) · CoinGecko · GDELT daily files · World Bank · UN Comtrade preview
       ├─ store    data/history/*.csv   (each series' full history, committed to git)
       ├─ score    indicator → asset class → global index (+ contagion)
       ├─ model    forecast · regime · alerts · scenarios · countries · corridors · events · data health
       └─ write    public/data/*.json
  └─ git commit + push  ──►  Cloudflare builds (npm run build) and deploys dist/
Browser reads the static JSON. No backend, no keys in the browser.
```

### Scoring (primer section 4)

```
Indicator stress = 0.40·P + 0.25·M + 0.20·V + 0.10·C + 0.05·N
```

- **P** percentile of the level over ~3 years (for “any big move is stress” series, the size of the 20-day move)
- **M** 20-day momentum as a z-score against its own history
- **V** percentile of 20-day realised volatility
- **C** contagion: percentile of average absolute 60-day correlation across 11 core markets
- **N** GDELT news pressure

Asset classes are weighted averages of their indicators; the global index is a weighted average of
classes plus a contagion adjustment (up to +12). Confidence = 0.40 freshness + 0.25 source reliability
+ 0.20 completeness + 0.15 fetch stability. Full detail is in the site's Guide.

**Backtest** (`Charts → Since 2015`): ~99 in March 2020, 83 in the October 2022 rate shock, 76 in the
August 2024 carry unwind, 81 in the April 2025 tariff shock; ~30 in calm spells.

### Data sources (all free, keyless)

| Source | Used for | Cadence |
|---|---|---|
| [FRED](https://fred.stlouisfed.org/) public CSV | yields, curve, breakevens, credit spreads, S&P 500, Nasdaq, VIX, stress indices, dollar, oil, gas | daily / weekly |
| [Frankfurter](https://frankfurter.dev/) | ECB reference FX for ~30 currencies | daily |
| [CoinGecko](https://www.coingecko.com/en/api) | Bitcoin, Ether, PAX Gold (gold proxy) | daily |
| [GDELT 1.0 daily events](https://www.gdeltproject.org/data.html) | news tone, conflict share, stress-keyword share, per-country news stress | daily |
| [World Bank](https://data.worldbank.org/) | structural country indicators | annual (cached 30 days) |
| [UN Comtrade](https://comtradeplus.un.org/) public preview | corridor trade values | annual (cached 30 days) |
| Central banks | Fed, ECB, BoE, RBI calendars in `pipeline/calendar_seed.json` | review in Dec and Mar |

Optional: a free `FRED_API_KEY` GitHub secret adds US CPI / jobs / GDP / PCE release dates to Event Watch.

---

## Interface

- Left nav rail: Dashboard, Globe, Trade, Scenario Lab, Charts, Guide, Sources. `/` focuses search.
- **Light / After Dark**: the globe shows the real day/night terminator for the current moment (subsolar
  point, updated every minute) with city lights on the night side. After Dark is the original navy (red in
  Dense) and faces the night side with a starfield. Light keeps the same navy frame around a muted grey
  content area and faces the sunlit side. Defaults to local time; the choice is remembered.
- **Clean / Dense**: Dense adds component breakdowns, members and extra metrics.

## One-time setup (about 15 minutes)

1. **Create the GitHub repo** `amanm17/StormDesk.Aman` (public or private; both are free for this).
2. **Push** from this folder on your Mac:
   ```bash
   cd ~/Documents/Personal\ Project/StormDesk/StormDesk.Aman
   find .git -name '*.lock' -delete          # clears any stale lock left by the sync
   git remote add origin https://github.com/amanm17/StormDesk.Aman.git
   git push -u origin main
   ```
3. **Allow the bot to commit**: repo → Settings → Actions → General → Workflow permissions →
   *Read and write permissions* → Save.
4. **Connect Cloudflare** (free): Cloudflare dashboard → Workers & Pages → Create → Import a repository →
   pick `StormDesk.Aman`. Build command `npm run build`, deploy command `npx wrangler deploy`.
   Every push, including each data refresh, now redeploys the site.
5. **Run the first refresh**: repo → Actions → *Refresh StormDesk data* → Run workflow. After that it
   runs by itself at 06:47, 12:47, 18:47 and 00:47 IST.

## Run locally

```bash
pip install -r requirements.txt
npm install
npm run pipeline        # fetch + score (≈2–5 min; first GDELT backfill downloads 90 days)
npm run dev             # http://127.0.0.1:5173
npm test                # Python unit tests
npm run typecheck && npm run build
```

`npm run pipeline:fast` skips GDELT downloads and reuses stored news history.

## Repository

```
pipeline/                 Python: sources, history store, scoring, analytics, countries, corridors, events, health
  registry.py             every indicator: source, direction, transform, weight
  calendar_seed.json      official central-bank dates (edit twice a year)
data/history/             one CSV per series, grows every run (committed)
data/cache/               World Bank and Comtrade responses (30-day refresh)
public/data/              JSON the site reads (written by the pipeline; do not hand-edit)
src/                      React + TypeScript (Vite), ECharts, Three.js globe
  content/guide.ts        Guide chapter index (page body in src/pages/pages.tsx)
tests/                    scoring unit tests
.github/workflows/        refresh.yml (4× a day), ci.yml (tests, typecheck, build)
docs/                     the two StormDesk primers
```

## Maintenance

- **Calendar**: when Data Health shows the calendar as *Stale*, add the next official dates to
  `pipeline/calendar_seed.json` (RBI publishes its fiscal-year schedule each March).
- **A source fails**: the pipeline falls back to stored history and Data Health says so; nothing breaks.
- **Inactive repo**: GitHub pauses schedules after 60 days without commits; the bot's refresh commits
  keep it active.

## Limits, stated plainly

- Free data lags: FRED oil prices trail by about a week; World Bank data is annual.
- ICE BofA credit spreads are only free for the last three years; crypto history starts at 365 days and grows.
- Proxies are imperfect: gold uses the PAX Gold token; news stress comes from GDELT tone and link keywords.
- Forecasts project stress levels, not prices. Nothing here is investment advice.

Licence of data belongs to each provider; see the Sources page for attribution terms.
