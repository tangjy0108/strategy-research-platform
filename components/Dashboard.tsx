'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import { BacktestParams, BacktestResponse, RunHistoryItem, ScanParamKey, ScanResponse, StrategyId, Trade } from '@/lib/types';
import { downloadPdfReport } from '@/lib/pdf';
import { listRunHistory, saveRunHistory } from '@/lib/client-db';

const defaultParams: BacktestParams = {
  strategy: 'trend_pullback',
  exchange: 'binance',
  symbol: 'BTCUSDT',
  timeframe: '15m',
  limit: 800,
  feeBps: 4,
  slippageBps: 2,
  atrLength: 14,
  stopAtrMult: 1,
  rrTarget: 2,
  maxBarsInTrade: 80,
  htfTimeframe: '1h',
  htfFastEma: 50,
  htfSlowEma: 200,
  ltfEma: 20,
  adxLength: 14,
  adxThreshold: 20,
  pullbackAtrMult: 0.6,
  lookbackBars: 5,
  snrStrength: 15,
  fvgMinSizePct: 0.05,
  volumeThreshold: 1.1,
  signalGap: 3,
  graceBars: 5,
  lqSweepLookback: 5,
  tcTapWindow: 3,
  fvgFreshnessBars: 20,
  zoneAtrBuffer: 0.15,
  fvgMaxHits: 2,
  scanXKey: 'adxThreshold',
  scanYKey: 'rrTarget',
  scanXValues: [18, 20, 22, 25],
  scanYValues: [1.5, 2, 2.5, 3],
};

const scanKeyOptions: { value: ScanParamKey; label: string }[] = [
  { value: 'adxThreshold', label: 'ADX Threshold' },
  { value: 'rrTarget', label: 'RR Target' },
  { value: 'snrStrength', label: 'SNR Strength' },
  { value: 'stopAtrMult', label: 'Stop ATR Mult' },
  { value: 'signalGap', label: 'Signal Gap' },
  { value: 'volumeThreshold', label: 'Volume Threshold' },
];

function fmt(v: number, digits = 2) {
  return Number.isFinite(v) ? v.toFixed(digits) : '-';
}

function parseNumberList(value: string): number[] {
  return value.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v));
}

function strategyLabel(strategy: StrategyId) {
  return strategy === 'trend_pullback' ? 'HTF Trend + Pullback' : 'SNR + FVG + LQ / TC';
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function polylinePoints(points: { equity: number }[], width = 860, height = 220) {
  const min = Math.min(...points.map((p) => p.equity));
  const max = Math.max(...points.map((p) => p.equity));
  return points.map((p, i) => {
    const x = points.length === 1 ? 0 : (i / (points.length - 1)) * width;
    const y = max === min ? height / 2 : height - ((p.equity - min) / (max - min)) * height;
    return `${x},${y}`;
  }).join(' ');
}

function drawdownArea(points: { drawdownPct: number }[], width = 860, height = 220) {
  const max = Math.max(...points.map((p) => p.drawdownPct), 0.0001);
  const coords = points.map((p, i) => {
    const x = points.length === 1 ? 0 : (i / (points.length - 1)) * width;
    const y = (p.drawdownPct / max) * height;
    return `${x},${y}`;
  }).join(' ');
  return `0,${height} ${coords} ${width},${height}`;
}

export default function Dashboard() {
  const [params, setParams] = useState<BacktestParams>(defaultParams);
  const [scanXText, setScanXText] = useState((defaultParams.scanXValues || []).join(', '));
  const [scanYText, setScanYText] = useState((defaultParams.scanYValues || []).join(', '));
  const [result, setResult] = useState<BacktestResponse | null>(null);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [history, setHistory] = useState<RunHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanLoading, setScanLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tradeSetup, setTradeSetup] = useState('all');
  const [tradeSide, setTradeSide] = useState<'all' | Trade['side']>('all');
  const [tradeRegime, setTradeRegime] = useState<'all' | Trade['regime']>('all');
  const [tradeExit, setTradeExit] = useState<'all' | Trade['exitReason']>('all');
  const [heatMetric, setHeatMetric] = useState<'profitFactor' | 'expectancyR' | 'winRate' | 'maxDrawdownPct'>('profitFactor');

  useEffect(() => {
    listRunHistory(20).then(setHistory).catch(() => undefined);
  }, []);

  const bestCell = useMemo(() => {
    return [...(scanResult?.cells || [])].sort((a, b) => (b.profitFactor - b.maxDrawdownPct * 0.1) - (a.profitFactor - a.maxDrawdownPct * 0.1))[0];
  }, [scanResult]);

  const filteredTrades = useMemo(() => {
    const trades = result?.trades || [];
    return trades.filter((t) =>
      (tradeSetup === 'all' || t.setup === tradeSetup) &&
      (tradeSide === 'all' || t.side === tradeSide) &&
      (tradeRegime === 'all' || t.regime === tradeRegime) &&
      (tradeExit === 'all' || t.exitReason === tradeExit)
    );
  }, [result, tradeSetup, tradeSide, tradeRegime, tradeExit]);

  const uniqueSetups = [...new Set((result?.trades || []).map((t) => t.setup))];

  async function persistHistory(json: BacktestResponse, payload: BacktestParams) {
    const item: RunHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      symbol: payload.symbol,
      strategy: payload.strategy,
      exchange: payload.exchange,
      timeframe: payload.timeframe,
      totalTrades: json.summary.totalTrades,
      winRate: json.summary.winRate,
      profitFactor: json.summary.profitFactor,
      maxDrawdownPct: json.summary.maxDrawdownPct,
      finalEquity: json.summary.finalEquity,
      paramsJson: JSON.stringify(payload),
      reportMarkdown: json.reportMarkdown,
    };
    await saveRunHistory(item);
    setHistory(await listRunHistory(20));
  }

  async function runBacktest() {
    setLoading(true);
    setError(null);
    try {
      const payload = { ...params, scanXValues: parseNumberList(scanXText), scanYValues: parseNumberList(scanYText) };
      const res = await fetch('/api/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Backtest failed');
      setResult(json);
      await persistHistory(json, payload);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backtest failed');
    } finally {
      setLoading(false);
    }
  }

  async function runScan() {
    setScanLoading(true);
    setError(null);
    try {
      const payload = { ...params, scanXValues: parseNumberList(scanXText), scanYValues: parseNumberList(scanYText) };
      const res = await fetch('/api/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Scan failed');
      setScanResult(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setScanLoading(false);
    }
  }

  const heatStats = useMemo(() => {
    const vals = (scanResult?.cells || []).map((c) => c[heatMetric]);
    const min = vals.length ? Math.min(...vals) : 0;
    const max = vals.length ? Math.max(...vals) : 1;
    return { min, max };
  }, [scanResult, heatMetric]);

  function heatColor(value: number) {
    if (heatMetric === 'maxDrawdownPct') {
      const ratio = heatStats.max === heatStats.min ? 0.5 : (value - heatStats.min) / (heatStats.max - heatStats.min);
      return `hsl(${120 - ratio * 120}, 65%, 30%)`;
    }
    const ratio = heatStats.max === heatStats.min ? 0.5 : (value - heatStats.min) / (heatStats.max - heatStats.min);
    return `hsl(${120 * Math.min(Math.max(ratio, 0), 1)}, 70%, 35%)`;
  }

  return (
    <div className="page">
      <div className="hero">
        <div>
          <h1>Strategy Research Platform v3.2.1</h1>
          <p>修正 sql.js 在 Next.js build 的 bundling 問題，保留前端 SQLite run history / PDF report / FVG fill depth。</p>
        </div>
        <div className="small">Next.js / Vercel-ready</div>
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h2>Strategy Runs</h2>
          <div className="form-grid two">
            <div>
              <label className="label">Strategy</label>
              <select className="select" value={params.strategy} onChange={(e) => setParams((p) => ({ ...p, strategy: e.target.value as StrategyId }))}>
                <option value="trend_pullback">HTF Trend + Pullback</option>
                <option value="snr_fvg_lq_tc">SNR + FVG + LQ / TC</option>
              </select>
            </div>
            <div>
              <label className="label">Exchange</label>
              <select className="select" value={params.exchange} onChange={(e) => setParams((p) => ({ ...p, exchange: e.target.value as BacktestParams['exchange'] }))}>
                <option value="binance">Binance</option>
                <option value="okx">OKX</option>
              </select>
            </div>
            <div><label className="label">Symbol</label><input className="input" value={params.symbol} onChange={(e) => setParams((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))} /></div>
            <div><label className="label">Timeframe</label><select className="select" value={params.timeframe} onChange={(e) => setParams((p) => ({ ...p, timeframe: e.target.value as BacktestParams['timeframe'] }))}><option value="5m">5m</option><option value="15m">15m</option><option value="1h">1h</option><option value="4h">4h</option></select></div>
            <div><label className="label">Limit</label><input className="input" type="number" value={params.limit} onChange={(e) => setParams((p) => ({ ...p, limit: Number(e.target.value) }))} /></div>
            <div><label className="label">RR Target</label><input className="input" type="number" step="0.1" value={params.rrTarget} onChange={(e) => setParams((p) => ({ ...p, rrTarget: Number(e.target.value) }))} /></div>
            <div><label className="label">ATR Length</label><input className="input" type="number" value={params.atrLength} onChange={(e) => setParams((p) => ({ ...p, atrLength: Number(e.target.value) }))} /></div>
            <div><label className="label">Stop ATR Mult</label><input className="input" type="number" step="0.1" value={params.stopAtrMult} onChange={(e) => setParams((p) => ({ ...p, stopAtrMult: Number(e.target.value) }))} /></div>
            <div><label className="label">Fee (bps)</label><input className="input" type="number" value={params.feeBps} onChange={(e) => setParams((p) => ({ ...p, feeBps: Number(e.target.value) }))} /></div>
            <div><label className="label">Slippage (bps)</label><input className="input" type="number" value={params.slippageBps} onChange={(e) => setParams((p) => ({ ...p, slippageBps: Number(e.target.value) }))} /></div>
          </div>

          {params.strategy === 'trend_pullback' ? (
            <div style={{ marginTop: 16 }}>
              <h3>Trend Pullback Params</h3>
              <div className="form-grid two">
                <div><label className="label">HTF</label><select className="select" value={params.htfTimeframe} onChange={(e) => setParams((p) => ({ ...p, htfTimeframe: e.target.value as BacktestParams['htfTimeframe'] }))}><option value="1h">1h</option><option value="4h">4h</option></select></div>
                <div><label className="label">ADX Threshold</label><input className="input" type="number" step="0.1" value={params.adxThreshold} onChange={(e) => setParams((p) => ({ ...p, adxThreshold: Number(e.target.value) }))} /></div>
                <div><label className="label">HTF Fast EMA</label><input className="input" type="number" value={params.htfFastEma} onChange={(e) => setParams((p) => ({ ...p, htfFastEma: Number(e.target.value) }))} /></div>
                <div><label className="label">HTF Slow EMA</label><input className="input" type="number" value={params.htfSlowEma} onChange={(e) => setParams((p) => ({ ...p, htfSlowEma: Number(e.target.value) }))} /></div>
                <div><label className="label">LTF EMA</label><input className="input" type="number" value={params.ltfEma} onChange={(e) => setParams((p) => ({ ...p, ltfEma: Number(e.target.value) }))} /></div>
                <div><label className="label">Pullback ATR Mult</label><input className="input" type="number" step="0.1" value={params.pullbackAtrMult} onChange={(e) => setParams((p) => ({ ...p, pullbackAtrMult: Number(e.target.value) }))} /></div>
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 16 }}>
              <h3>SNR / FVG / LQ / TC Params</h3>
              <div className="form-grid two">
                <div><label className="label">SNR Strength</label><input className="input" type="number" value={params.snrStrength} onChange={(e) => setParams((p) => ({ ...p, snrStrength: Number(e.target.value) }))} /></div>
                <div><label className="label">FVG Min Size %</label><input className="input" type="number" step="0.01" value={params.fvgMinSizePct} onChange={(e) => setParams((p) => ({ ...p, fvgMinSizePct: Number(e.target.value) }))} /></div>
                <div><label className="label">Volume Threshold</label><input className="input" type="number" step="0.1" value={params.volumeThreshold} onChange={(e) => setParams((p) => ({ ...p, volumeThreshold: Number(e.target.value) }))} /></div>
                <div><label className="label">Signal Gap</label><input className="input" type="number" value={params.signalGap} onChange={(e) => setParams((p) => ({ ...p, signalGap: Number(e.target.value) }))} /></div>
                <div><label className="label">Grace Bars</label><input className="input" type="number" value={params.graceBars} onChange={(e) => setParams((p) => ({ ...p, graceBars: Number(e.target.value) }))} /></div>
                <div><label className="label">Sweep Lookback</label><input className="input" type="number" value={params.lqSweepLookback} onChange={(e) => setParams((p) => ({ ...p, lqSweepLookback: Number(e.target.value) }))} /></div>
                <div><label className="label">TC Tap Window</label><input className="input" type="number" value={params.tcTapWindow} onChange={(e) => setParams((p) => ({ ...p, tcTapWindow: Number(e.target.value) }))} /></div>
                <div><label className="label">FVG Freshness Bars</label><input className="input" type="number" value={params.fvgFreshnessBars} onChange={(e) => setParams((p) => ({ ...p, fvgFreshnessBars: Number(e.target.value) }))} /></div>
                <div><label className="label">Zone ATR Buffer</label><input className="input" type="number" step="0.01" value={params.zoneAtrBuffer} onChange={(e) => setParams((p) => ({ ...p, zoneAtrBuffer: Number(e.target.value) }))} /></div>
                <div><label className="label">FVG Max Hits</label><input className="input" type="number" value={params.fvgMaxHits || 2} onChange={(e) => setParams((p) => ({ ...p, fvgMaxHits: Number(e.target.value) }))} /></div>
              </div>
            </div>
          )}

          <div style={{ marginTop: 16 }}>
            <h3>Parameter Lab</h3>
            <div className="form-grid two">
              <div><label className="label">X Key</label><select className="select" value={params.scanXKey} onChange={(e) => setParams((p) => ({ ...p, scanXKey: e.target.value as ScanParamKey }))}>{scanKeyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className="label">Y Key</label><select className="select" value={params.scanYKey} onChange={(e) => setParams((p) => ({ ...p, scanYKey: e.target.value as ScanParamKey }))}>{scanKeyOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
              <div><label className="label">X Values</label><input className="input" value={scanXText} onChange={(e) => setScanXText(e.target.value)} /></div>
              <div><label className="label">Y Values</label><input className="input" value={scanYText} onChange={(e) => setScanYText(e.target.value)} /></div>
            </div>
          </div>

          <div className="actions" style={{ marginTop: 14 }}>
            <button className="btn" onClick={runBacktest} disabled={loading}>{loading ? 'Running...' : 'Run Backtest'}</button>
            <button className="btn secondary" onClick={runScan} disabled={scanLoading}>{scanLoading ? 'Scanning...' : 'Run Parameter Lab'}</button>
            {result && <button className="btn ghost" onClick={() => downloadText(`research-report-${params.symbol}-${params.strategy}.md`, result.reportMarkdown)}>Markdown</button>}
            {result && <button className="btn ghost" onClick={() => downloadPdfReport(result)}>PDF</button>}
          </div>
          {error && <div style={{ marginTop: 12, color: '#ff9999' }}>{error}</div>}
        </div>

        <div className="grid">
          <div className="card">
            <h2>Summary Dashboard</h2>
            {!result ? <div className="small">先執行一次回測。</div> : (
              <div className="kpis">
                <div className="kpi"><div className="label">Strategy</div><div className="value" style={{ fontSize: 18 }}>{strategyLabel(result.params.strategy)}</div><div className="hint">K線數：{result.klinesMeta.count}</div></div>
                <div className="kpi"><div className="label">Total Trades</div><div className="value">{result.summary.totalTrades}</div><div className="hint">Win Rate：{fmt(result.summary.winRate)}%</div></div>
                <div className="kpi"><div className="label">Profit Factor</div><div className="value">{fmt(result.summary.profitFactor)}</div><div className="hint">Expectancy R：{fmt(result.summary.expectancyR, 3)}</div></div>
                <div className="kpi"><div className="label">Max Drawdown</div><div className="value">{fmt(result.summary.maxDrawdownPct)}%</div><div className="hint">Final Equity：{fmt(result.summary.finalEquity)}</div></div>
              </div>
            )}
          </div>

          <div className="card">
            <div className="flex space"><h2>Equity Curve</h2><span className="small">SVG polyline + drawdown overlay</span></div>
            {!result || !result.equityCurve.length ? <div className="small">尚無資料。</div> : (
              <svg viewBox="0 0 860 260" className="equity-svg" role="img" aria-label="Equity curve">
                <polygon points={drawdownArea(result.equityCurve, 860, 220)} fill="rgba(255,122,122,0.14)" transform="translate(0,20)" />
                <polyline points={polylinePoints(result.equityCurve, 860, 220)} fill="none" stroke="#7cc7ff" strokeWidth="3" transform="translate(0,20)" />
              </svg>
            )}
          </div>
        </div>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card">
          <h2>Run History (SQLite)</h2>
          <div className="small" style={{ marginBottom: 12 }}>使用 sql.js 在瀏覽器端保存最近研究結果，可跟著 Vercel 前端一起部署。</div>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Time</th><th>Symbol</th><th>Strategy</th><th>Trades</th><th>PF</th><th>DD</th><th>Equity</th></tr></thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{new Date(h.createdAt).toLocaleString()}</td>
                    <td>{h.symbol}</td>
                    <td>{strategyLabel(h.strategy)}</td>
                    <td>{h.totalTrades}</td>
                    <td>{fmt(h.profitFactor)}</td>
                    <td>{fmt(h.maxDrawdownPct)}%</td>
                    <td>{fmt(h.finalEquity)}</td>
                  </tr>
                ))}
                {!history.length && <tr><td colSpan={7} className="small">尚無歷史 run。</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <h2>Breakdown</h2>
          {!result ? <div className="small">先跑回測。</div> : (
            <div className="grid breakdown-4">
              {[
                ['Setup Breakdown', result.setupBreakdown],
                ['Regime Breakdown', result.regimeBreakdown],
                ['Exit Breakdown', result.exitBreakdown],
                ['Pine-like State', result.stateBreakdown.map((r) => ({ key: r.key, trades: r.count, winRate: 0, profitFactor: 0, avgR: 0 }))],
              ].map(([title, rows]) => (
                <div key={String(title)}>
                  <h3>{title}</h3>
                  <div className="table-wrap"><table><thead><tr><th>Key</th><th>Count</th><th>Win</th><th>PF</th><th>Avg R</th></tr></thead><tbody>{(rows as any[]).map((r) => <tr key={r.key}><td>{r.key}</td><td>{r.trades}</td><td>{r.winRate ? `${fmt(r.winRate)}%` : '-'}</td><td>{r.profitFactor ? fmt(r.profitFactor) : '-'}</td><td>{r.avgR ? fmt(r.avgR) : '-'}</td></tr>)}</tbody></table></div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex space"><h2>Trade Breakdown</h2><span className="small">含篩選器</span></div>
          {!result ? <div className="small">先跑回測。</div> : (
            <>
              <div className="form-grid four compact-grid" style={{ marginBottom: 12 }}>
                <div><label className="label">Setup</label><select className="select" value={tradeSetup} onChange={(e) => setTradeSetup(e.target.value)}><option value="all">All</option>{uniqueSetups.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
                <div><label className="label">Side</label><select className="select" value={tradeSide} onChange={(e) => setTradeSide(e.target.value as any)}><option value="all">All</option><option value="long">long</option><option value="short">short</option></select></div>
                <div><label className="label">Regime</label><select className="select" value={tradeRegime} onChange={(e) => setTradeRegime(e.target.value as any)}><option value="all">All</option><option value="trend_bull">trend_bull</option><option value="trend_bear">trend_bear</option><option value="chop">chop</option></select></div>
                <div><label className="label">Exit</label><select className="select" value={tradeExit} onChange={(e) => setTradeExit(e.target.value as any)}><option value="all">All</option><option value="target">target</option><option value="stop">stop</option><option value="time_end">time_end</option></select></div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>ID</th><th>Setup</th><th>Side</th><th>Regime</th><th>Entry</th><th>Exit</th><th>PnL %</th><th>R</th><th>Bars</th><th>Exit</th></tr></thead>
                  <tbody>
                    {filteredTrades.slice(0, 150).map((t) => (
                      <tr key={t.id}>
                        <td>{t.id}</td><td>{t.setup}</td><td>{t.side}</td><td>{t.regime}</td>
                        <td>{new Date(t.entryTime).toLocaleDateString()}</td><td>{new Date(t.exitTime).toLocaleDateString()}</td>
                        <td style={{ color: t.pnlPct >= 0 ? '#62d2a2' : '#ff8a8a' }}>{fmt(t.pnlPct, 3)}%</td>
                        <td>{fmt(t.pnlR, 2)}</td><td>{t.barsHeld}</td><td>{t.exitReason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="flex space"><h2>Parameter Heatmap</h2><span className="small">Best cell 依 PF - 0.1 × DD 排序</span></div>
          {!scanResult ? <div className="small">先跑 Parameter Lab。</div> : (
            <>
              <div className="form-grid two" style={{ marginBottom: 12 }}>
                <div><label className="label">Heatmap Metric</label><select className="select" value={heatMetric} onChange={(e) => setHeatMetric(e.target.value as any)}><option value="profitFactor">Profit Factor</option><option value="expectancyR">Expectancy R</option><option value="winRate">Win Rate</option><option value="maxDrawdownPct">Max Drawdown</option></select></div>
                <div className="small" style={{ display: 'flex', alignItems: 'end' }}>{bestCell ? `Best: ${scanResult.xKey}=${bestCell.x}, ${scanResult.yKey}=${bestCell.y}, PF=${fmt(bestCell.profitFactor)}, DD=${fmt(bestCell.maxDrawdownPct)}%` : '—'}</div>
              </div>
              <div className="heatmap-grid" style={{ gridTemplateColumns: `140px repeat(${scanResult.yValues.length}, minmax(100px, 1fr))` }}>
                <div className="heat-head"></div>
                {scanResult.yValues.map((v) => <div key={`y-${v}`} className="heat-head">{scanResult.yKey}={v}</div>)}
                {scanResult.xValues.map((x) => (
                  <Fragment key={`row-${x}`}>
                    <div className="heat-head">{scanResult.xKey}={x}</div>
                    {scanResult.yValues.map((y) => {
                      const cell = scanResult.cells.find((c) => c.x === x && c.y === y);
                      if (!cell) return <div key={`${x}-${y}`} className="heat-cell">-</div>;
                      return (
                        <div key={`${x}-${y}`} className="heat-cell" style={{ background: heatColor(cell[heatMetric]) }} title={`PF ${fmt(cell.profitFactor)} | WR ${fmt(cell.winRate)} | DD ${fmt(cell.maxDrawdownPct)}%`}>
                          <div className="heat-score">{fmt(cell[heatMetric])}</div>
                          <div className="small">Trades {cell.totalTrades}</div>
                          <div className="small">PF {fmt(cell.profitFactor)}</div>
                          <div className="small">DD {fmt(cell.maxDrawdownPct)}%</div>
                        </div>
                      );
                    })}
                  </Fragment>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="card">
          <h2>Research Report</h2>
          {!result ? <div className="small">先跑回測。</div> : <pre className="report">{result.reportMarkdown}</pre>}
        </div>
      </div>
    </div>
  );
}
