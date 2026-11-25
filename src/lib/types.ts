// Shapes of the static JSON the pipeline writes to public/data/.

export type Mode = 'clean' | 'dense';
export type View = 'dashboard' | 'globe' | 'trade' | 'scenario' | 'charts';
export type Page = 'workbench' | 'guide' | 'sources';

export type ForecastBand = { mean: number; low: number; high: number; weather: string };
export type Forecast = {
  available: boolean;
  current?: number;
  method?: string;
  '1w'?: ForecastBand;
  '1m'?: ForecastBand;
  direction?: 'worsening' | 'easing' | 'steady';
  backtest?: { days: number; mae_model: number; mae_no_change: number };
};

export type AssetClass = {
  key: string;
  title: string;
  score: number;
  weather: string;
  confidence: number;
  weight_in_global: number;
  driver: string;
  source: string;
  delta_5d: number | null;
  series: (number | null)[];
  members: { key: string; label: string; stress: number | null }[];
  forecast: Forecast | null;
};

export type Indicator = {
  key: string;
  label: string;
  asset_class: string;
  available: boolean;
  source?: string;
  source_id?: string;
  direction?: 'up' | 'down' | 'abs';
  transform?: 'pct' | 'diff';
  unit?: string;
  freq?: string;
  weight?: number;
  note?: string;
  date?: string;
  value?: number;
  display?: string;
  change_1d?: number | null;
  change_20d?: number | null;
  z?: number | null;
  P?: number | null;
  M?: number | null;
  V?: number | null;
  C?: number | null;
  N?: number | null;
  level_percentile?: number | null;
  stress?: number | null;
  stress_5d_ago?: number | null;
  weather?: string;
  confidence?: number;
  freshness?: number;
  age_days?: number | null;
  reliability?: number;
  completeness?: number;
  fetch?: string;
  values?: (number | null)[];
  value_dates?: string[];
  stress_series?: (number | null)[];
};

export type Alert = { severity: 'high' | 'medium' | 'low'; category: string; date: string; text: string; key?: string | null };

export type ScenarioStep = { shock: number; global: number; classes: Record<string, number> };
export type Scenario = { id: string; label: string; unit: string; note: string; base_global: number; steps: ScenarioStep[] };

export type EventItem = {
  date: string; region: string; source: string; event: string; importance: number;
  days_until: number; event_pressure: number; weather: string;
};
export type EventRisk = {
  generated_at: string; source: string; reviewed_on: string; calendar_sources: Record<string, string>;
  event_risk_score: number; event_weather: string; top_events: EventItem[]; all_upcoming_events: EventItem[];
  needs_update: boolean; model_note: string;
};

export type TapeItem = {
  key: string; label: string; value: number; display: string; change: number | null; change_unit: string;
  date: string; source: string; weather: string; direction?: 'up' | 'down' | 'abs';
};

export type WeatherBand = { low: number; high: number; label: string; meaning: string };

export type Snapshot = {
  schema_version: string;
  generated_at: string;
  as_of: string;
  product: { name: string; byline: string; full_name: string };
  global: {
    score: number; weather: string; confidence: number; raw_weighted: number; contagion_adj: number; breadth: number;
    delta_5d: number; delta_20d: number; dominant: { key: string; title: string; score: number }; percentile_since_2015: number;
  };
  regime: { name: string; why: string };
  forecast: Forecast;
  correlation: { avg_abs_corr: number; percentile: number; series: (number | null)[] };
  scores: Record<string, number | null>;
  asset_classes: AssetClass[];
  indicators: Indicator[];
  market_tape: TapeItem[];
  alerts: Alert[];
  history: {
    dates: string[]; global: (number | null)[]; classes: Record<string, (number | null)[]>;
    correlation: (number | null)[]; regimes: { date: string; regime: string }[];
  };
  long_history: { dates: string[]; global: number[] };
  scenarios: Scenario[];
  event_risk: EventRisk;
  source_status: Record<string, unknown>;
  methodology: {
    indicator_formula: string; component_weights: Record<string, number>; class_weights: Record<string, number>;
    confidence_formula: string; source_reliability: Record<string, number>; global_formula: string;
    weather_bands: WeatherBand[]; windows: Record<string, string>;
  };
};

export type Country = {
  iso2?: string; iso3: string; name: string; capital?: string | null; lat: number; lng: number;
  region?: string; subregion?: string; population?: number; flag?: string;
  stress: number; weather: string; confidence: number; confidence_label: string;
  components: { structural: number | null; exposure: number | null; currency: number | null; news: number | null };
  data_quality: 'ok' | 'thin';
  currency?: string | null;
  news?: { score: number; tone_7d: number; conflict_7d: number; events_7d: number } | null;
  drivers: string[];
  source: string;
};
export type CountryPayload = { generated_at: string; source: string; note: string; weights: Record<string, number>; countries: Country[] };

export type Corridor = {
  id: string; from: string; to: string; commodity: string; commodity_class: string; rationale: string; hs_codes: string | null;
  from_name: string; to_name: string; from_lat: number; from_lng: number; to_lat: number; to_lng: number;
  origin_stress: number; destination_stress: number; channel_stress: number; dependency: number;
  trade_value_usd: number | null; trade_year: number | null; share_of_importer_imports: number | null;
  stress: number; weather: string; confidence: number; drivers: string[]; model: string;
};
export type CorridorPayload = { generated_at: string; source: string; note: string; corridor_count: number; trade_score: number | null; corridors: Corridor[] };

export type HealthSource = {
  key: string; label: string; url?: string; cadence?: string; status: string; health: string; confidence: number;
  fetched_at?: string; latest_observation?: string | null; oldest_age_days?: number | null;
  series_live: number; series_cached: number; series_failed: number; note: string; errors: string[]; layer_type: string;
};
export type HealthPayload = {
  generated_at: string;
  summary: { live_count: number; proxy_or_partial_count: number; blocked_or_missing_count: number; average_confidence: number; overall_health: string };
  sources: HealthSource[];
  legend: Record<string, string>;
};
