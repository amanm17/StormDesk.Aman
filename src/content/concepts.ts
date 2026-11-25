// Learn-page knowledge cards. Plain-language first, then the deeper explanation and references.
export type Concept = { title: string; short: string; long: string; refs: [string, string][] };

export const concepts: Concept[] = [
  {
    title: 'Volatility',
    short: 'How violently a price or indicator moves over time.',
    long: 'Volatility measures the dispersion of returns or indicator values. In StormDesk, rising volatility matters because stress is often not just about level, but about the speed and instability of movement. A moderate yield or FX move can become dangerous if volatility rises across multiple markets at once.',
    refs: [
      ['CFA Institute volatility overview', 'https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/option-replication-using-put-call-parity'],
      ['CFA Institute fixed-income learning', 'https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/term-structure-and-interest-rate-dynamics']
    ]
  },
  {
    title: 'Yield Curve',
    short: 'The relationship between short-term and long-term interest rates.',
    long: 'The yield curve helps interpret expectations about growth, inflation, monetary policy and term premia. A sharply inverted curve can imply restrictive policy or growth concerns. StormDesk treats yield-curve stress as a bond-market pressure signal, especially when curve changes coincide with volatility and credit-spread widening.',
    refs: [
      ['CFA Institute yield curve strategies', 'https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/yield-curve-strategies'],
      ['FRED Treasury series', 'https://fred.stlouisfed.org/']
    ]
  },
  {
    title: 'Credit Spread',
    short: 'The extra yield demanded for risky debt over safer debt.',
    long: 'Credit spreads compensate investors for credit, liquidity and default-related risks. When spreads widen quickly, financial conditions are usually tightening. StormDesk uses public spread series and ETF proxies to estimate credit stress where institutional corporate-bond datasets are unavailable.',
    refs: [
      ['CFA Institute credit strategies', 'https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/fixed-income-active-management-credit-strategies'],
      ['FRED economic data access', 'https://fred.stlouisfed.org/docs/api/fred/']
    ]
  },
  {
    title: 'Liquidity Stress',
    short: 'Difficulty converting assets into cash without price damage.',
    long: 'Liquidity stress appears when investors cannot transact smoothly or must accept large price concessions. StormDesk approximates liquidity pressure using public proxies such as dollar strength, credit spreads, Treasury volatility behaviour and safe-haven demand. This is not a perfect replacement for institutional funding-market feeds, so confidence scoring is important.',
    refs: [
      ['BIS Basel III LCR document', 'https://www.bis.org/publ/bcbs238.pdf'],
      ['BIS liquidity requirements speech', 'https://www.bis.org/speeches/sp250611.htm']
    ]
  },
  {
    title: 'Current Account',
    short: 'A country’s trade and income balance with the rest of the world.',
    long: 'Current-account pressure matters because countries with persistent external deficits may be more vulnerable to FX stress, imported inflation or capital-flow reversals. StormDesk links current-account and trade-exposure ideas to FX pressure, commodity dependence and partner-country demand.',
    refs: [
      ['IMF current account deficits explainer', 'https://www.imf.org/en/publications/fandd/issues/series/back-to-basics/current-account-deficits'],
      ['IMF External Sector Reports', 'https://www.imf.org/en/publications/sprolls/external-sector-reports']
    ]
  },
  {
    title: 'Proxy Indicator',
    short: 'A transparent approximation for unavailable or expensive data.',
    long: 'A proxy is useful when the direct measure is proprietary, expensive or unavailable at high frequency. For example, CDS spreads may be approximated with credit ETF behaviour and public spread series; shipping stress may be approximated with trade, commodity and news-flow data. StormDesk should always label proxies clearly and score their confidence.',
    refs: [
      ['FRED economic data access', 'https://fred.stlouisfed.org/docs/api/fred/'],
      ['St. Louis Fed FRED overview', 'https://fredhelp.stlouisfed.org/fred/about/about-fred/what-is-fred/']
    ]
  },
  {
    title: 'Z-score',
    short: 'How far a value sits from its historical average.',
    long: 'A z-score expresses abnormality in standard-deviation units. A z-score of +2 means the current reading is two standard deviations above its mean. StormDesk uses z-scores to compare unlike indicators on a common stress scale, while also checking percentiles to avoid overinterpreting non-normal distributions.',
    refs: [
      ['NIST Engineering Statistics Handbook', 'https://www.itl.nist.gov/div898/handbook/']
    ]
  },
  {
    title: 'Percentile',
    short: 'A historical rank of today’s reading.',
    long: 'Percentiles help answer: how unusual is this signal compared with its own history? If bond stress is in the 90th percentile, it is higher than 90 percent of observed history. Percentiles are useful for public-data systems because they are explainable and robust to different units.',
    refs: [
      ['CFA Institute volatility overview', 'https://www.cfainstitute.org/insights/professional-learning/refresher-readings/2026/option-replication-using-put-call-parity']
    ]
  },
  {
    title: 'Trade Exposure',
    short: 'Sensitivity to import dependence or export concentration.',
    long: 'Trade exposure connects financial weather to the real economy. A country exposed to imported energy, food or critical inputs can experience FX and inflation pressure when commodity prices rise. Export concentration can also expose countries or businesses to demand shocks in a small number of partner markets.',
    refs: [
      ['IMF external sector reports', 'https://www.imf.org/en/publications/sprolls/external-sector-reports'],
      ['IMF current account explainer', 'https://www.imf.org/en/publications/fandd/issues/series/back-to-basics/current-account-deficits']
    ]
  },
  {
    title: 'Nowcast',
    short: 'A present-condition estimate built from live and delayed signals.',
    long: 'A nowcast is not a long-term prediction. It estimates the current state using available information. StormDesk combines fast signals like market prices and news with slower signals like macro and trade data to infer the current financial-weather regime.',
    refs: [
      ['FRED economic data access', 'https://fred.stlouisfed.org/docs/api/fred/']
    ]
  },
  {
    title: 'Regime Detection',
    short: 'Classifying conditions as calm, risk-off or crisis-like.',
    long: 'Regime detection groups market states into interpretable environments. Instead of claiming exact forecasts, StormDesk can classify whether the system looks calm, risk-off, liquidity-stressed or crisis-like. This helps users understand context before interpreting any one indicator.',
    refs: [
      ['IMF financial stability definition', 'https://www.elibrary.imf.org/display/book/9781589064409/ch005.xml']
    ]
  },
  {
    title: 'Contagion',
    short: 'Stress transmission across assets, countries or sectors.',
    long: 'Contagion occurs when stress in one part of the system spreads into another. Oil can transmit into inflation, inflation into yields, yields into equities, and equities into credit. StormDesk’s arcs and pressure routes are designed to make this chain visible.',
    refs: [
      ['IMF External Sector Reports', 'https://www.imf.org/en/publications/sprolls/external-sector-reports'],
      ['BIS publications', 'https://www.bis.org/']
    ]
  }
];
