import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpen, CalendarClock, Database, Gauge, Globe2, Landmark, LineChart, Route, Search, X } from 'lucide-react';
import type { CorridorPayload, CountryPayload, HealthPayload, Page, Snapshot, View } from '../lib/types';
import { concepts } from '../content/concepts';
import { fmt } from '../lib/weather';

type Item = { title: string; subtitle: string; type: string; tags: string; go: () => void; icon: JSX.Element };

export default function CommandSearch({ snapshot, countries, corridors, health, goView, goPage, focusCountry, focusCorridor, focusIndicator }: {
  snapshot: Snapshot | null; countries: CountryPayload | null; corridors: CorridorPayload | null; health: HealthPayload | null;
  goView: (v: View) => void; goPage: (p: Page) => void;
  focusCountry: (name: string) => void; focusCorridor: (q: string) => void; focusIndicator: (key: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName?.match(/INPUT|TEXTAREA|SELECT/);
      if ((e.key === 'k' && (e.metaKey || e.ctrlKey)) || (e.key === '/' && !typing)) {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const catalogue = useMemo((): Item[] => {
    const items: Item[] = [];
    const page = (title: string, subtitle: string, go: () => void, icon: JSX.Element, tags = '') =>
      items.push({ title, subtitle, type: 'Page', tags, go, icon });
    page('Dashboard', 'Global weather, alerts, asset classes', () => goView('dashboard'), <Gauge size={15} />, 'home overview');
    page('Globe', 'Country weather and trade arcs', () => goView('globe'), <Globe2 size={15} />, 'map countries');
    page('Trade Weather', 'Corridors weighted by UN Comtrade values', () => goView('trade'), <Route size={15} />, 'exports imports comtrade');
    page('Scenario Lab', 'Shock oil, yields, the dollar, VIX, credit', () => goView('scenario'), <Gauge size={15} />, 'stress test what if simulate');
    page('Charts', 'History, forecasts, indicators, exports', () => goView('charts'), <LineChart size={15} />, 'chart excel csv png download forecast');
    page('Methodology', 'Formulas, weights, windows, backtest', () => goPage('methodology'), <BookOpen size={15} />, 'formula weights confidence model');
    page('Sources', 'Data health and source lineage', () => goPage('sources'), <Database size={15} />, 'data health freshness licence');
    page('Learn', 'How to read the weather', () => goPage('learn'), <BookOpen size={15} />, 'guide glossary beginner');

    snapshot?.asset_classes.forEach((a) => items.push({
      title: a.title, subtitle: `${Math.round(a.score)} · ${a.weather} · ${a.driver}`, type: 'Asset class',
      tags: `${a.key} ${a.members.map((m) => m.label).join(' ')}`, go: () => goView('dashboard'), icon: <Gauge size={15} />,
    }));
    snapshot?.indicators.filter((i) => i.available).forEach((i) => items.push({
      title: i.label, subtitle: `${i.display} · stress ${fmt(i.stress)} ${i.weather} · ${i.source?.toUpperCase()} ${i.source_id}`, type: 'Market signal',
      tags: `${i.key} ${i.source_id} ${i.asset_class}`, go: () => { focusIndicator(i.key); goView('charts'); }, icon: <LineChart size={15} />,
    }));
    countries?.countries.forEach((c) => items.push({
      title: c.name, subtitle: `${fmt(c.stress)} · ${c.weather} · confidence ${c.confidence}%`, type: 'Country',
      tags: `${c.iso3} ${c.iso2 ?? ''} ${c.region ?? ''} ${c.subregion ?? ''} ${c.currency ?? ''}`, go: () => { focusCountry(c.name); goView('globe'); }, icon: <Landmark size={15} />,
    }));
    corridors?.corridors.forEach((c) => items.push({
      title: `${c.from_name} → ${c.to_name}`, subtitle: `${c.commodity} · ${Math.round(c.stress)} ${c.weather}`, type: 'Trade corridor',
      tags: `${c.commodity_class} ${c.commodity} ${c.from} ${c.to}`, go: () => { focusCorridor(`${c.from_name} ${c.to_name} ${c.commodity}`); goView('trade'); }, icon: <Route size={15} />,
    }));
    snapshot?.event_risk.all_upcoming_events.slice(0, 30).forEach((e) => items.push({
      title: e.event, subtitle: `${e.date} · ${e.region} · in ${e.days_until} days`, type: 'Event',
      tags: `${e.source} central bank meeting rates`, go: () => goView('dashboard'), icon: <CalendarClock size={15} />,
    }));
    concepts.forEach((c) => items.push({ title: c.title, subtitle: c.short, type: 'Concept', tags: 'learn concept', go: () => goPage('learn'), icon: <BookOpen size={15} /> }));
    health?.sources.forEach((s) => items.push({
      title: s.label, subtitle: `${s.health} · ${s.note}`, type: 'Source', tags: `${s.key} source data health`, go: () => goPage('sources'), icon: <Database size={15} />,
    }));
    return items;
  }, [snapshot, countries, corridors, health, goView, goPage, focusCountry, focusCorridor, focusIndicator]);

  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return catalogue.filter((i) => i.type === 'Page' || i.type === 'Asset class').slice(0, 10);
    const tokens = q.split(/\s+/);
    return catalogue
      .map((item) => {
        const title = item.title.toLowerCase();
        const hay = `${title} ${item.subtitle.toLowerCase()} ${item.tags.toLowerCase()} ${item.type.toLowerCase()}`;
        let score = 0;
        if (title === q) score += 120;
        if (title.startsWith(q)) score += 70;
        if (title.includes(q)) score += 45;
        if (hay.includes(q)) score += 20;
        for (const t of tokens) score += title.includes(t) ? 18 : hay.includes(t) ? 8 : -6;
        return { item, score };
      })
      .filter((x) => x.score > 10)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.item);
  }, [catalogue, q]);

  useEffect(() => setCursor(0), [q]);

  const run = (item: Item) => {
    item.go();
    setOpen(false);
    setQuery('');
    input.current?.blur();
  };

  const ext = encodeURIComponent(query.trim() || 'financial stress');
  return (
    <div className={open ? 'command-search search-open' : 'command-search'}>
      <Search size={17} />
      <input
        ref={input}
        placeholder="Search markets, countries, corridors, concepts…  ( / )"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setOpen(false); input.current?.blur(); }
          if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === 'Enter' && results[cursor]) run(results[cursor]);
        }}
      />
      {open && (
        <div className="search-command-panel">
          <div className="search-command-head">
            <span>StormDesk command search · {catalogue.length} items</span>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close search"><X size={14} /></button>
          </div>
          <div className="search-tips-row">
            <span>Try</span>
            {['India', 'oil', 'VIX', 'FOMC', 'credit', 'scenario'].map((t) => <button key={t} type="button" onClick={() => setQuery(t)}>{t}</button>)}
          </div>
          <div className="search-results">
            {results.map((r, i) => (
              <button key={`${r.type}-${r.title}`} type="button" className={`search-result-row ${i === cursor ? 'cursor' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => run(r)}>
                <span className="result-icon">{r.icon}</span>
                <span><b>{r.title}</b><em>{r.type} · {r.subtitle}</em></span>
              </button>
            ))}
            {!results.length && <p className="muted-note">No match. Try a country, an indicator (VIX, BTC, HY spread) or a concept.</p>}
          </div>
          <div className="search-api-row">
            <span>Search the sources for “{query.trim() || 'financial stress'}”:</span>
            <a href={`https://fred.stlouisfed.org/searchresults/?st=${ext}`} target="_blank" rel="noopener noreferrer">FRED</a>
            <a href={`https://data.worldbank.org/search?q=${ext}`} target="_blank" rel="noopener noreferrer">World Bank</a>
            <a href={`https://comtradeplus.un.org/`} target="_blank" rel="noopener noreferrer">Comtrade</a>
            <a href={`https://data.imf.org/en/search?text=${ext}`} target="_blank" rel="noopener noreferrer">IMF</a>
          </div>
        </div>
      )}
    </div>
  );
}
