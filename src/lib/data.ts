import { useCallback, useEffect, useState } from 'react';
import type { CorridorPayload, CountryPayload, HealthPayload, Snapshot } from './types';

// Works at the site root and under any sub-path (Vite BASE_URL).
export function dataUrl(name: string) {
  return `${import.meta.env.BASE_URL}data/${name}`;
}

async function getJson<T>(name: string): Promise<T> {
  const res = await fetch(`${dataUrl(name)}?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export type StormData = {
  snapshot: Snapshot | null;
  countries: CountryPayload | null;
  corridors: CorridorPayload | null;
  health: HealthPayload | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
};

const REFRESH_MS = 5 * 60 * 1000; // the pipeline refreshes four times a day; poll every 5 minutes

export function useStormData(): StormData {
  const [state, setState] = useState<Omit<StormData, 'reload'>>({
    snapshot: null, countries: null, corridors: null, health: null, error: null, loading: true,
  });

  const load = useCallback(async () => {
    const results = await Promise.allSettled([
      getJson<Snapshot>('latest_snapshot.json'),
      getJson<CountryPayload>('country_vulnerability.json'),
      getJson<CorridorPayload>('trade_corridors.json'),
      getJson<HealthPayload>('data_health.json'),
    ]);
    const [s, c, t, h] = results;
    const errors = results.filter((r) => r.status === 'rejected').map((r) => String((r as PromiseRejectedResult).reason));
    setState((prev) => ({
      snapshot: s.status === 'fulfilled' ? s.value : prev.snapshot,
      countries: c.status === 'fulfilled' ? c.value : prev.countries,
      corridors: t.status === 'fulfilled' ? t.value : prev.corridors,
      health: h.status === 'fulfilled' ? h.value : prev.health,
      error: errors.length ? errors.join('; ') : null,
      loading: false,
    }));
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, REFRESH_MS);
    const onFocus = () => load();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [load]);

  return { ...state, reload: load };
}
