import { useEffect, useMemo, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { BarChart3, FileImage, FileJson, FileSpreadsheet, FileText } from 'lucide-react';
import type { Mode, Snapshot } from '../lib/types';
import type { Theme } from '../lib/weather';
import { CLASS_ORDER, bandColours, stressColour } from '../lib/weather';
import { downloadCsv, downloadDataUrl, downloadJson, downloadXlsx, type Cell } from '../lib/exporters';

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, MarkAreaComponent, MarkLineComponent, MarkPointComponent, DataZoomComponent, CanvasRenderer]);

type ChartMode = 'global' | 'classes' | 'indicator' | 'long' | 'correlation';
type Win = '3M' | '6M' | '1Y';
const WIN_DAYS: Record<Win, number> = { '3M': 65, '6M': 130, '1Y': 260 };
const CLASS_COLOURS = ['#38bdf8', '#f472b6', '#facc15', '#a78bfa', '#34d399', '#fb923c', '#f87171', '#94a3b8'];
const EPISODES: [string, string][] = [['2015-08-28', 'China devaluation'], ['2016-02-12', 'Oil low'], ['2018-12-28', 'Q4 2018 sell-off'], ['2020-03-20', 'COVID crash'], ['2022-10-14', 'Rate shock'], ['2023-03-17', 'US bank stress'], ['2024-08-09', 'Yen carry unwind'], ['2025-04-11', 'Tariff shock']];


export default function ChartStudio({ mode, theme, snapshot, initialIndicator }: { mode: Mode; theme: Theme; snapshot: Snapshot | null; initialIndicator?: string | null }) {
  const [chartMode, setChartMode] = useState<ChartMode>('global');
  const [win, setWin] = useState<Win>('6M');
  const [indKey, setIndKey] = useState<string>(initialIndicator ?? 'hy_oas');
  const el = useRef<HTMLDivElement | null>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (initialIndicator) { setIndKey(initialIndicator); setChartMode('indicator'); }
  }, [initialIndicator]);

  const indicators = useMemo(() => (snapshot?.indicators ?? []).filter((i) => i.available), [snapshot]);
  const ind = indicators.find((i) => i.key === indKey) ?? indicators[0];

  const table = useMemo((): { title: string; header: string[]; rows: Cell[][] } => {
    if (!snapshot) return { title: '', header: [], rows: [] };
    const h = snapshot.history;
    const n = WIN_DAYS[win];
    if (chartMode === 'global') {
      return { title: 'Global index', header: ['date', 'global_stress'], rows: h.dates.slice(-n).map((d, i) => [d, h.global.slice(-n)[i]]) };
    }
    if (chartMode === 'classes') {
      const keys = CLASS_ORDER.filter((k) => h.classes[k]);
      return { title: 'Class stress', header: ['date', ...keys], rows: h.dates.slice(-n).map((d, i) => [d, ...keys.map((k) => h.classes[k].slice(-n)[i])]) };
    }
    if (chartMode === 'correlation') {
      return { title: 'Correlation pctl', header: ['date', 'correlation_percentile'], rows: h.dates.slice(-n).map((d, i) => [d, h.correlation.slice(-n)[i]]) };
    }
    if (chartMode === 'long') {
      return { title: 'Global index, weekly', header: ['week', 'global_stress'], rows: snapshot.long_history.dates.map((d, i) => [d, snapshot.long_history.global[i]]) };
    }
    if (!ind) return { title: '', header: [], rows: [] };
    return { title: ind.label, header: ['date', `value (${ind.unit})`], rows: (ind.value_dates ?? []).map((d, i) => [d, ind.values?.[i] ?? null]) };
  }, [snapshot, chartMode, win, ind]);

  useEffect(() => {
    if (!el.current) return;
    chart.current = echarts.init(el.current, undefined, { renderer: 'canvas' });
    const onResize = () => chart.current?.resize();
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(el.current);
    return () => { window.removeEventListener('resize', onResize); ro.disconnect(); chart.current?.dispose(); chart.current = null; };
  }, []);

  useEffect(() => {
    if (!chart.current || !snapshot) return;
    const day = theme === 'day';
    const text = day ? '#e0f2fe' : '#cbd5e1';
    const grid = day ? 'rgba(224,242,254,0.16)' : 'rgba(148,163,184,0.15)';
    const bandAreas = bandColours(theme).map((b) => [{ yAxis: b.low, itemStyle: { color: b.colour, opacity: day ? 0.09 : 0.06 } }, { yAxis: b.high }]);
    const fc = day ? '#fff7d6' : '#e2e8f0';
    const base = {
      backgroundColor: 'transparent',
      textStyle: { color: text, fontFamily: 'inherit' },
      tooltip: { trigger: 'axis', backgroundColor: day ? '#06325f' : '#0f172a', borderColor: day ? '#38bdf8' : '#334155', textStyle: { color: '#e2e8f0' } },
      grid: { left: 44, right: 18, top: 36, bottom: 40 },
      xAxis: { type: 'category', axisLine: { lineStyle: { color: grid } }, axisLabel: { color: text } },
      yAxis: { type: 'value', splitLine: { lineStyle: { color: grid } }, axisLabel: { color: text } },
    };
    const n = WIN_DAYS[win];
    const h = snapshot.history;
    let option: echarts.EChartsCoreOption;
    if (chartMode === 'global' || chartMode === 'correlation') {
      const isG = chartMode === 'global';
      const dates = h.dates.slice(-n);
      const vals = (isG ? h.global : h.correlation).slice(-n);
      const f = snapshot.forecast;
      const fx: string[] = [];
      const fMean: (number | null)[] = [];
      const fLow: (number | null)[] = [];
      const fBand: (number | null)[] = [];
      if (isG && f.available && f['1w'] && f['1m']) {
        const pad = dates.map(() => null);
        fx.push('+1w', '+1m');
        fMean.push(...pad.slice(0, -1), vals[vals.length - 1], f['1w'].mean, f['1m'].mean);
        fLow.push(...pad, f['1w'].low, f['1m'].low);
        fBand.push(...pad, f['1w'].high - f['1w'].low, f['1m'].high - f['1m'].low);
      }
      option = {
        ...base,
        legend: { top: 4, textStyle: { color: text } },
        xAxis: { ...base.xAxis, data: [...dates, ...fx] },
        yAxis: { ...base.yAxis, min: 0, max: 100 },
        series: [
          { name: isG ? 'Global' : 'Correlation pctl', type: 'line', data: vals, showSymbol: false, lineStyle: { width: 2.4, color: isG ? stressColour(snapshot.global.score) : '#a78bfa' }, itemStyle: { color: isG ? stressColour(snapshot.global.score) : '#a78bfa' },
            markArea: isG ? { silent: true, data: bandAreas } : undefined },
          ...(fx.length ? [
            { name: 'Forecast', type: 'line', data: fMean, lineStyle: { type: 'dashed', color: fc }, itemStyle: { color: fc }, symbolSize: 6 },
            { name: '80% band', type: 'line', data: fLow, stack: 'band', lineStyle: { opacity: 0 }, showSymbol: false, tooltip: { show: false } },
            { name: '80% band', type: 'line', data: fBand, stack: 'band', lineStyle: { opacity: 0 }, showSymbol: false, areaStyle: { color: day ? 'rgba(255,247,214,0.16)' : 'rgba(226,232,240,0.15)' }, tooltip: { show: false } },
          ] : []),
        ],
      };
    } else if (chartMode === 'classes') {
      const dates = h.dates.slice(-n);
      const keys = CLASS_ORDER.filter((k) => h.classes[k]);
      option = {
        ...base,
        legend: { top: 4, textStyle: { color: text }, type: 'scroll' },
        xAxis: { ...base.xAxis, data: dates },
        yAxis: { ...base.yAxis, min: 0, max: 100 },
        series: keys.map((k, i) => ({ name: snapshot.asset_classes.find((a) => a.key === k)?.title ?? k, type: 'line', data: h.classes[k].slice(-n), showSymbol: false, lineStyle: { width: 1.8 }, color: CLASS_COLOURS[i % CLASS_COLOURS.length] })),
      };
    } else if (chartMode === 'long') {
      const L = snapshot.long_history;
      option = {
        ...base,
        xAxis: { ...base.xAxis, data: L.dates },
        yAxis: { ...base.yAxis, min: 0, max: 100 },
        dataZoom: [{ type: 'inside' }, { type: 'slider', height: 16, bottom: 6, textStyle: { color: text } }],
        grid: { ...base.grid, bottom: 52 },
        series: [{
          name: 'Global (weekly)', type: 'line', data: L.global, showSymbol: false, lineStyle: { width: 1.8, color: '#38bdf8' }, itemStyle: { color: '#38bdf8' },
          markArea: { silent: true, data: bandAreas },
          markPoint: {
            symbolSize: 34, label: { fontSize: 9, color: '#0f172a' }, itemStyle: { color: '#facc15' },
            data: EPISODES.map(([d, name]) => {
              const i = L.dates.findIndex((x) => x >= d);
              return i >= 0 ? { name, coord: [L.dates[i], L.global[i]], value: Math.round(L.global[i]) } : null;
            }).filter(Boolean),
          },
        }],
      };
    } else {
      const dates = ind?.value_dates ?? [];
      option = {
        ...base,
        legend: { top: 4, textStyle: { color: text } },
        xAxis: { ...base.xAxis, data: dates },
        yAxis: [{ ...base.yAxis, scale: true, name: ind?.unit, nameTextStyle: { color: text } }, { type: 'value', min: 0, max: 100, splitLine: { show: false }, axisLabel: { color: text }, name: 'stress' }],
        series: [
          { name: `${ind?.label} (${ind?.unit})`, type: 'line', data: ind?.values ?? [], showSymbol: false, lineStyle: { width: 2, color: '#38bdf8' }, itemStyle: { color: '#38bdf8' } },
          { name: 'Stress', type: 'line', yAxisIndex: 1, data: [...Array(Math.max(0, dates.length - (ind?.stress_series?.length ?? 0))).fill(null), ...(ind?.stress_series ?? [])], showSymbol: false, lineStyle: { width: 1.6, type: 'dashed', color: stressColour(ind?.stress) }, itemStyle: { color: stressColour(ind?.stress) } },
        ],
      };
    }
    chart.current.setOption(option, true);
  }, [snapshot, chartMode, win, ind, theme]);

  const stamp = snapshot?.as_of ?? 'latest';
  const fname = `stormdesk-${chartMode}${chartMode === 'indicator' ? `-${ind?.key}` : ''}-${stamp}`;
  const exportPng = () => {
    const url = chart.current?.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: theme === 'day' ? '#0b5a9a' : '#0b1220' });
    if (url) downloadDataUrl(`${fname}.png`, url);
  };
  const exportXlsx = () => {
    if (!snapshot) return;
    const h = snapshot.history;
    const keys = CLASS_ORDER.filter((k) => h.classes[k]);
    downloadXlsx(`stormdesk-workbook-${stamp}.xlsx`, [
      { name: 'This chart', rows: [table.header, ...table.rows] },
      { name: 'Global history', rows: [['date', 'global', ...keys, 'correlation_pct'], ...h.dates.map((d, i) => [d, h.global[i], ...keys.map((k) => h.classes[k][i]), h.correlation[i]])] },
      { name: 'Indicators', rows: [['key', 'label', 'class', 'source', 'value', 'unit', 'date', 'change_20d', 'level_percentile', 'momentum_z', 'P', 'M', 'V', 'C', 'N', 'stress', 'weather', 'confidence'],
        ...snapshot.indicators.filter((i) => i.available).map((i) => [i.key, i.label, i.asset_class, i.source, i.value, i.unit, i.date, i.change_20d, i.level_percentile, i.z, i.P, i.M, i.V, i.C, i.N, i.stress, i.weather, i.confidence])] },
      { name: 'Asset classes', rows: [['class', 'score', 'weather', 'confidence', 'delta_5d', 'weight_in_global', 'driver'], ...snapshot.asset_classes.map((a) => [a.title, a.score, a.weather, a.confidence, a.delta_5d, a.weight_in_global, a.driver])] },
      { name: 'About', rows: [['StormDesk by Aman'], [`Snapshot ${snapshot.generated_at}`], ['Sources: FRED, Frankfurter (ECB), CoinGecko, GDELT, World Bank, UN Comtrade'], ['Not financial advice']] },
    ]);
  };

  return (
    <section className="panel chart-studio">
      <div className="panel-title">
        <BarChart3 size={17} />
        <h2>Charts</h2>
        <span>{table.title}</span>
      </div>
      <div className="chart-controls">
        <div className="seg">
          {([['global', 'Global'], ['classes', 'Classes'], ['indicator', 'Indicator'], ['correlation', 'Contagion'], ['long', 'Since 2015']] as [ChartMode, string][]).map(([k, l]) => (
            <button key={k} className={chartMode === k ? 'active' : ''} onClick={() => setChartMode(k)}>{l}</button>
          ))}
        </div>
        {chartMode !== 'long' && chartMode !== 'indicator' && (
          <div className="seg">
            {(['3M', '6M', '1Y'] as Win[]).map((w) => <button key={w} className={win === w ? 'active' : ''} onClick={() => setWin(w)}>{w}</button>)}
          </div>
        )}
        {chartMode === 'indicator' && (
          <select value={ind?.key} onChange={(e) => setIndKey(e.target.value)} aria-label="Indicator">
            {indicators.map((i) => <option key={i.key} value={i.key}>{i.label}</option>)}
          </select>
        )}
      </div>
      <div ref={el} className="chart-canvas" style={{ height: mode === 'dense' ? 340 : 280 }} />
      {chartMode === 'global' && snapshot?.forecast?.backtest && (
        <p className="muted-note small">
          1w forecast error {snapshot.forecast.backtest.mae_model} pts vs {snapshot.forecast.backtest.mae_no_change} for no change · {snapshot.forecast.backtest.days}d out of sample
        </p>
      )}
      {chartMode === 'long' && <p className="muted-note small">Markers: known stress episodes</p>}
      {chartMode === 'indicator' && ind && <p className="muted-note small">{ind.source?.toUpperCase()} {ind.source_id} · {ind.direction === 'up' ? 'higher = stress' : ind.direction === 'down' ? 'lower = stress' : 'moves either way = stress'}{ind.note ? ` · ${ind.note}` : ''}</p>}
      <div className="chart-exports">
        <button onClick={exportPng}><FileImage size={14} /> PNG</button>
        <button onClick={() => downloadCsv(`${fname}.csv`, [table.header, ...table.rows])}><FileText size={14} /> CSV</button>
        <button onClick={exportXlsx}><FileSpreadsheet size={14} /> Excel</button>
        <button onClick={() => downloadJson(`${fname}.json`, { title: table.title, generated_at: snapshot?.generated_at, header: table.header, rows: table.rows })}><FileJson size={14} /> JSON</button>
      </div>
    </section>
  );
}
