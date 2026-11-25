// Guide chapter index (used by the Guide page and search).
export const GUIDE_CHAPTERS = [
  { id: 'weather', title: 'The weather scale', tags: 'bands clear cloudy rain storm watch severe hurricane metaphor' },
  { id: 'score', title: 'Indicator stress score', tags: 'percentile momentum volatility correlation news P M V C N direction formula' },
  { id: 'classes', title: 'Asset classes', tags: 'weights members bonds credit equities liquidity fx commodities crypto news' },
  { id: 'global', title: 'Global index', tags: 'contagion adjustment breadth percentile since 2015' },
  { id: 'confidence', title: 'Confidence', tags: 'freshness reliability completeness fetch thin data' },
  { id: 'outlook', title: 'Outlook', tags: 'forecast AR(1) band backtest next week month' },
  { id: 'regime', title: 'Regimes', tags: 'risk-off liquidity squeeze crisis calm mixed inflation rates shock' },
  { id: 'alerts', title: 'Alerts', tags: 'rules sigma percentile band change' },
  { id: 'countries', title: 'Country weather', tags: 'structural exposure currency news globe thin data world bank' },
  { id: 'corridors', title: 'Trade corridors', tags: 'channel dependency comtrade trade index' },
  { id: 'scenarios', title: 'Scenario Lab', tags: 'shock beta linear stress test' },
  { id: 'events', title: 'Event pressure', tags: 'calendar fomc ecb boe rbi decay' },
  { id: 'data', title: 'Data, proxies and refresh', tags: 'sources health status proxy pax gold gdelt tape colours schedule day night terminator' },
] as const;
