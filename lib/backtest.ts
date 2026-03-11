import { adx, atr, ema, rma } from './indicators';
import { BacktestParams, BacktestResponse, GroupMetric, Kline, StateMetric, StrategyId, Trade } from './types';

type OpenPosition = {
  strategy: StrategyId;
  side: 'long' | 'short';
  setup: string;
  regime: Trade['regime'];
  entryIndex: number;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
};

type PendingSignal = {
  strategy: StrategyId;
  side: 'long' | 'short';
  setup: string;
  regime: Trade['regime'];
  signalIndex: number;
  signalPrice: number;
  expiresAt: number;
  atrAtSignal: number;
};

type ZoneSNR = {
  wickY: number;
  bodyY: number;
  startBar: number;
  isRes: boolean;
};

type ZoneFVG = {
  top: number;
  bottom: number;
  mid: number;
  startBar: number;
  isBull: boolean;
  hitCount: number;
  maxFillRatio: number;
};

function resampleKlines(klines: Kline[], sourceTf: string, targetTf: string): Kline[] {
  const minutesMap: Record<string, number> = { '5m': 5, '15m': 15, '1h': 60, '4h': 240 };
  const src = minutesMap[sourceTf] ?? 15;
  const tgt = minutesMap[targetTf] ?? 60;
  const factor = Math.max(1, Math.round(tgt / src));
  const out: Kline[] = [];
  for (let i = 0; i < klines.length; i += factor) {
    const chunk = klines.slice(i, i + factor);
    if (!chunk.length) continue;
    out.push({
      time: chunk[0].time,
      open: chunk[0].open,
      high: Math.max(...chunk.map((k) => k.high)),
      low: Math.min(...chunk.map((k) => k.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, k) => s + k.volume, 0),
    });
  }
  return out;
}

function buildLookup<T>(keys: number[], values: T[]): Map<number, T> {
  const map = new Map<number, T>();
  keys.forEach((k, i) => map.set(k, values[i]));
  return map;
}

function calcGroupMetrics(trades: Trade[], getKey: (t: Trade) => string): GroupMetric[] {
  const groups = new Map<string, Trade[]>();
  for (const trade of trades) {
    const key = getKey(trade);
    const arr = groups.get(key) ?? [];
    arr.push(trade);
    groups.set(key, arr);
  }

  return Array.from(groups.entries()).map(([key, arr]) => {
    const wins = arr.filter((t) => t.pnlPct > 0);
    const losses = arr.filter((t) => t.pnlPct <= 0);
    const grossProfit = wins.reduce((s, t) => s + t.pnlPct, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0));
    return {
      key,
      trades: arr.length,
      winRate: arr.length ? (wins.length / arr.length) * 100 : 0,
      avgR: arr.length ? arr.reduce((s, t) => s + t.pnlR, 0) / arr.length : 0,
      profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
      avgPnlPct: arr.length ? arr.reduce((s, t) => s + t.pnlPct, 0) / arr.length : 0,
    };
  }).sort((a, b) => b.trades - a.trades);
}

function calcStateBreakdown(stateCounts: Record<string, number>): StateMetric[] {
  return Object.entries(stateCounts)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([key, count]) => ({ key, count }));
}

function buildReport(
  summary: BacktestResponse['summary'],
  setupBreakdown: GroupMetric[],
  regimeBreakdown: GroupMetric[],
  exitBreakdown: GroupMetric[],
  stateBreakdown: StateMetric[],
  params: BacktestParams,
  trades: Trade[],
  klinesMeta: BacktestResponse['klinesMeta'],
) {
  const f2 = (n: number) => n.toFixed(2);
  const f3 = (n: number) => n.toFixed(3);
  const pct = (n: number) => `${f2(n)}%`;
  const ts = (ms: number) => new Date(ms).toISOString().slice(0, 10);

  const stratName = params.strategy === 'trend_pullback'
    ? 'HTF Trend + LTF Pullback'
    : 'SMC — SNR + FVG + LQ / TC';

  const wins  = trades.filter(t => t.pnlR > 0);
  const loses = trades.filter(t => t.pnlR <= 0);
  const avgWin  = wins.length  ? wins.reduce((s, t) => s + t.pnlR, 0)  / wins.length  : 0;
  const avgLoss = loses.length ? loses.reduce((s, t) => s + t.pnlR, 0) / loses.length : 0;
  const rRatio  = avgLoss !== 0 ? Math.abs(avgWin / avgLoss) : 0;
  const longs  = trades.filter(t => t.side === 'long');
  const shorts = trades.filter(t => t.side === 'short');
  const longsWR  = longs.length  ? (longs.filter(t => t.pnlR > 0).length  / longs.length)  * 100 : 0;
  const shortsWR = shorts.length ? (shorts.filter(t => t.pnlR > 0).length / shorts.length) * 100 : 0;
  const avgBars = trades.length ? trades.reduce((s, t) => s + t.barsHeld, 0) / trades.length : 0;
  const maxConsecLoss = (() => {
    let best = 0, cur = 0;
    for (const t of trades) { if (t.pnlR <= 0) { cur++; best = Math.max(best, cur); } else cur = 0; }
    return best;
  })();

  const grp = (arr: GroupMetric[]) =>
    arr.map(g => `| ${g.key.padEnd(18)} | ${String(g.trades).padStart(5)} | ${pct(g.winRate).padStart(7)} | ${f2(g.profitFactor).padStart(5)} | ${f2(g.avgR).padStart(6)} | ${pct(g.avgPnlPct).padStart(8)} |`).join('\n');

  const paramBlock = params.strategy === 'trend_pullback'
    ? [
        `| htfTimeframe      | ${params.htfTimeframe}   |`,
        `| htfFastEma        | ${params.htfFastEma}     |`,
        `| htfSlowEma        | ${params.htfSlowEma}     |`,
        `| ltfEma            | ${params.ltfEma}         |`,
        `| adxThreshold      | ${params.adxThreshold}   |`,
        `| pullbackAtrMult   | ${params.pullbackAtrMult}|`,
      ].join('\n')
    : [
        `| snrStrength       | ${params.snrStrength}    |`,
        `| fvgMinSizePct     | ${params.fvgMinSizePct} |`,
        `| volumeThreshold   | ${params.volumeThreshold}|`,
        `| signalGap         | ${params.signalGap}      |`,
        `| graceBars         | ${params.graceBars}      |`,
        `| lqSweepLookback   | ${params.lqSweepLookback}|`,
        `| tcTapWindow       | ${params.tcTapWindow}    |`,
        `| fvgFreshnessBars  | ${params.fvgFreshnessBars}|`,
        `| zoneAtrBuffer     | ${params.zoneAtrBuffer}  |`,
        `| fvgMaxHits        | ${params.fvgMaxHits ?? 2}|`,
      ].join('\n');

  const pfGrade  = summary.profitFactor >= 2 ? '✅ 優秀 (≥2.0)' : summary.profitFactor >= 1.5 ? '✅ 良好 (≥1.5)' : summary.profitFactor >= 1 ? '⚠️ 勉強達標 (≥1.0)' : '❌ 不達標 (<1.0)';
  const wrGrade  = summary.winRate >= 55 ? '✅ 良好 (≥55%)' : summary.winRate >= 45 ? '⚠️ 尚可 (≥45%)' : '❌ 偏低 (<45%)';
  const exGrade  = summary.expectancyR >= 0.3 ? '✅ 良好 (≥0.3R)' : summary.expectancyR >= 0.1 ? '⚠️ 尚可 (≥0.1R)' : '❌ 偏低 (<0.1R)';
  const ddGrade  = summary.maxDrawdownPct <= 15 ? '✅ 低 (≤15%)' : summary.maxDrawdownPct <= 25 ? '⚠️ 中 (≤25%)' : '❌ 高 (>25%)';

  const lines = [
    `# Strategy Research Report`,
    `> Generated: ${new Date().toISOString().slice(0,19).replace('T',' ')} UTC`,
    '',
    '---',
    '',
    '## 1. Run Configuration',
    '',
    `| Parameter         | Value                   |`,
    `|-------------------|-------------------------|`,
    `| Strategy          | ${stratName}            |`,
    `| Exchange          | ${params.exchange}       |`,
    `| Symbol            | ${params.symbol}         |`,
    `| Timeframe         | ${params.timeframe}      |`,
    `| K-line Count      | ${klinesMeta.count}      |`,
    `| Period            | ${ts(klinesMeta.firstTime)} → ${ts(klinesMeta.lastTime)} |`,
    `| RR Target         | ${params.rrTarget}       |`,
    `| Stop ATR Mult     | ${params.stopAtrMult}    |`,
    `| ATR Length        | ${params.atrLength}      |`,
    `| Fee               | ${params.feeBps} bps     |`,
    `| Slippage          | ${params.slippageBps} bps|`,
    paramBlock,
    '',
    '---',
    '',
    '## 2. Core Performance Summary',
    '',
    `| Metric             | Value            | Grade         |`,
    `|--------------------|------------------|---------------|`,
    `| Total Trades       | ${summary.totalTrades}            | –             |`,
    `| Win Rate           | ${pct(summary.winRate)}        | ${wrGrade}    |`,
    `| Profit Factor      | ${f2(summary.profitFactor)}           | ${pfGrade}    |`,
    `| Expectancy (R)     | ${f3(summary.expectancyR)}          | ${exGrade}    |`,
    `| Avg PnL/Trade      | ${pct(summary.avgPnlPct)}        | –             |`,
    `| Max Drawdown       | ${pct(summary.maxDrawdownPct)}        | ${ddGrade}    |`,
    `| Final Equity       | ${f2(summary.finalEquity)}          | –             |`,
    '',
    '### Extended Statistics',
    '',
    `| Metric             | Value            |`,
    `|--------------------|------------------|`,
    `| Avg Win (R)        | ${f2(avgWin)}            |`,
    `| Avg Loss (R)       | ${f2(avgLoss)}           |`,
    `| Win/Loss R Ratio   | ${f2(rRatio)}            |`,
    `| Long Trades        | ${longs.length} (WR ${pct(longsWR)}) |`,
    `| Short Trades       | ${shorts.length} (WR ${pct(shortsWR)})|`,
    `| Avg Bars Held      | ${f2(avgBars)}           |`,
    `| Max Consec. Loss   | ${maxConsecLoss}             |`,
    '',
    '---',
    '',
    '## 3. Breakdown Analysis',
    '',
    '### 3a. Setup Breakdown',
    '',
    `| Setup              | Trades |   WR%   |   PF  | Avg R  | Avg PnL% |`,
    `|--------------------|--------|---------|-------|--------|----------|`,
    grp(setupBreakdown),
    '',
    '### 3b. Market Regime Breakdown',
    '',
    `| Regime             | Trades |   WR%   |   PF  | Avg R  | Avg PnL% |`,
    `|--------------------|--------|---------|-------|--------|----------|`,
    grp(regimeBreakdown),
    '',
    '### 3c. Exit Reason Breakdown',
    '',
    `| Exit Reason        | Trades |   WR%   |   PF  | Avg R  | Avg PnL% |`,
    `|--------------------|--------|---------|-------|--------|----------|`,
    grp(exitBreakdown),
    '',
    '### 3d. State / Signal Counts',
    '',
    ...stateBreakdown.map(s => `- **${s.key}**: ${s.count}`),
    '',
    '---',
    '',
    '## 4. Evaluation & Observations',
    '',
    `- Profit Factor ${pfGrade}`,
    `- Win Rate ${wrGrade}`,
    `- Expectancy ${exGrade}`,
    `- Max Drawdown ${ddGrade}`,
    `- Win/Loss R Ratio: ${f2(rRatio)} (>1.5 為佳，目前${rRatio >= 1.5 ? '✅' : rRatio >= 1 ? '⚠️' : '❌'})`,
    `- 做多勝率 ${pct(longsWR)} vs 做空勝率 ${pct(shortsWR)}${Math.abs(longsWR - shortsWR) > 15 ? ' ⚠️ 方向偏差顯著，考慮限制單邊操作' : ''}`,
    `- 最大連續虧損 ${maxConsecLoss} 筆${maxConsecLoss >= 5 ? ' ⚠️ 連續回撤偏高，建議檢查資金管理' : ''}`,
    '',
    '---',
    '',
    '## 5. Suggested Next Steps',
    '',
    summary.profitFactor < 1.5
      ? '- [ ] 提高 RR Target 或縮緊進場條件以改善 PF'
      : '- [x] PF 已達標，可進一步測試不同市場條件',
    summary.winRate < 45
      ? '- [ ] 勝率偏低，考慮調整進場過濾條件（如 ADX 門檻、FVG 新鮮度）'
      : '- [x] 勝率達標',
    summary.maxDrawdownPct > 25
      ? '- [ ] 最大回撤偏高，考慮降低 Stop ATR Mult 或加入最大持倉時間限制'
      : '- [x] 回撤在可接受範圍',
    '- [ ] 使用 Param Lab 掃描 RR Target × ADX Threshold 的最佳組合',
    '- [ ] 分別測試牛市與熊市期間的績效',
    '- [ ] 考慮加入多品種相關性分析',
  ];
  return lines.join('\n');
}

function barsRiskPct(entryPrice: number, stopPrice: number, side: 'long' | 'short') {
  return side === 'long'
    ? ((entryPrice - stopPrice) / entryPrice) * 100
    : ((stopPrice - entryPrice) / entryPrice) * 100;
}

function finalizeOpenPosition(
  trades: Trade[],
  equityCurve: BacktestResponse['equityCurve'],
  params: BacktestParams,
  openPosition: OpenPosition,
  exitIndex: number,
  exitPrice: number,
  exitReason: Trade['exitReason'],
  equityState: { equity: number; peak: number },
  klines: Kline[],
) {
  const effectiveExit = exitPrice * (openPosition.side === 'long'
    ? (1 - params.slippageBps / 10000)
    : (1 + params.slippageBps / 10000));

  const grossPct = openPosition.side === 'long'
    ? ((effectiveExit - openPosition.entryPrice) / openPosition.entryPrice) * 100
    : ((openPosition.entryPrice - effectiveExit) / openPosition.entryPrice) * 100;

  const netPct = grossPct - (2 * params.feeBps + params.slippageBps) / 100;
  const riskPct = barsRiskPct(openPosition.entryPrice, openPosition.stopPrice, openPosition.side);
  const pnlR = riskPct === 0 ? 0 : netPct / riskPct;

  equityState.equity *= 1 + netPct / 100;
  equityState.peak = Math.max(equityState.peak, equityState.equity);
  const drawdownPct = equityState.peak === 0 ? 0 : ((equityState.peak - equityState.equity) / equityState.peak) * 100;

  trades.push({
    id: trades.length + 1,
    strategy: openPosition.strategy,
    setup: openPosition.setup,
    side: openPosition.side,
    regime: openPosition.regime,
    entryTime: klines[openPosition.entryIndex].time,
    exitTime: klines[exitIndex].time,
    entryPrice: openPosition.entryPrice,
    exitPrice: effectiveExit,
    stopPrice: openPosition.stopPrice,
    targetPrice: openPosition.targetPrice,
    pnlPct: netPct,
    pnlR,
    barsHeld: exitIndex - openPosition.entryIndex,
    exitReason,
  });
  equityCurve.push({ time: klines[exitIndex].time, equity: equityState.equity, drawdownPct });
}

function calcRegime(trendBull: boolean, trendBear: boolean): Trade['regime'] {
  return trendBull ? 'trend_bull' : trendBear ? 'trend_bear' : 'chop';
}

function maybeFillPending(pending: PendingSignal, k: Kline, index: number, params: BacktestParams): OpenPosition | null {
  if (index <= pending.signalIndex || index > pending.expiresAt) return null;

  const touched = pending.side === 'long' ? k.low <= pending.signalPrice : k.high >= pending.signalPrice;
  if (!touched) return null;

  const entryPrice = pending.signalPrice * (pending.side === 'long'
    ? (1 + params.slippageBps / 10000)
    : (1 - params.slippageBps / 10000));

  const stopPrice = pending.side === 'long'
    ? entryPrice - pending.atrAtSignal * params.stopAtrMult
    : entryPrice + pending.atrAtSignal * params.stopAtrMult;

  const targetPrice = pending.side === 'long'
    ? entryPrice + (entryPrice - stopPrice) * params.rrTarget
    : entryPrice - (stopPrice - entryPrice) * params.rrTarget;

  return {
    strategy: pending.strategy,
    side: pending.side,
    setup: pending.setup,
    regime: pending.regime,
    entryIndex: index,
    entryPrice,
    stopPrice,
    targetPrice,
  };
}

function buildResponse(
  klines: Kline[],
  params: BacktestParams,
  trades: Trade[],
  equityCurve: BacktestResponse['equityCurve'],
  finalEquity: number,
  stateCounts: Record<string, number>,
): BacktestResponse {
  const wins = trades.filter((t) => t.pnlPct > 0);
  const losses = trades.filter((t) => t.pnlPct <= 0);
  const grossProfit = wins.reduce((sum, t) => sum + t.pnlPct, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnlPct, 0));
  const maxDrawdownPct = equityCurve.reduce((m, p) => Math.max(m, p.drawdownPct), 0);

  const summary = {
    totalTrades: trades.length,
    winRate: trades.length ? (wins.length / trades.length) * 100 : 0,
    profitFactor: grossLoss === 0 ? grossProfit : grossProfit / grossLoss,
    expectancyR: trades.length ? trades.reduce((s, t) => s + t.pnlR, 0) / trades.length : 0,
    avgPnlPct: trades.length ? trades.reduce((s, t) => s + t.pnlPct, 0) / trades.length : 0,
    maxDrawdownPct,
    finalEquity,
  };

  const setupBreakdown = calcGroupMetrics(trades, (t) => t.setup);
  const regimeBreakdown = calcGroupMetrics(trades, (t) => t.regime);
  const exitBreakdown = calcGroupMetrics(trades, (t) => t.exitReason);
  const stateBreakdown = calcStateBreakdown(stateCounts);
  const klinesMeta = {
    count: klines.length,
    firstTime: klines[0]?.time ?? 0,
    lastTime: klines[klines.length - 1]?.time ?? 0,
  };
  const reportMarkdown = buildReport(summary, setupBreakdown, regimeBreakdown, exitBreakdown, stateBreakdown, params, trades, klinesMeta);

  return {
    params,
    summary,
    trades,
    setupBreakdown,
    regimeBreakdown,
    exitBreakdown,
    stateBreakdown,
    equityCurve,
    reportMarkdown,
    klinesMeta,
  };
}

function runTrendPullback(klines: Kline[], params: BacktestParams): BacktestResponse {
  const htfKlines = resampleKlines(klines, params.timeframe, params.htfTimeframe);
  const htfCloses = htfKlines.map((k) => k.close);
  const htfFast = ema(htfCloses, params.htfFastEma);
  const htfSlow = ema(htfCloses, params.htfSlowEma);
  const htfAdx = adx(htfKlines, params.adxLength);
  const ltfCloses = klines.map((k) => k.close);
  const ltfEma = ema(ltfCloses, params.ltfEma);
  const atrVals = atr(klines, params.atrLength);

  const lookupFast = buildLookup(htfKlines.map((k) => k.time), htfFast);
  const lookupSlow = buildLookup(htfKlines.map((k) => k.time), htfSlow);
  const lookupAdx = buildLookup(htfKlines.map((k) => k.time), htfAdx);

  const trades: Trade[] = [];
  const equityCurve: BacktestResponse['equityCurve'] = [];
  const equityState = { equity: 100, peak: 100 };
  const stateCounts: Record<string, number> = { htf_bull: 0, htf_bear: 0, pullback_long_signal: 0, pullback_short_signal: 0 };
  let openPosition: OpenPosition | null = null;

  const startIndex = Math.max(params.lookbackBars + 2, 20);
  for (let i = startIndex; i < klines.length; i += 1) {
    const k = klines[i];
    let htfTime: number | undefined;
    for (let j = htfKlines.length - 1; j >= 0; j -= 1) {
      if (htfKlines[j].time < k.time) {
        htfTime = htfKlines[j].time;
        break;
      }
    }
    const hFast = htfTime ? lookupFast.get(htfTime) ?? 0 : 0;
    const hSlow = htfTime ? lookupSlow.get(htfTime) ?? 0 : 0;
    const hAdxVal = htfTime ? lookupAdx.get(htfTime) ?? 0 : 0;

    const trendBull = hFast > hSlow && hAdxVal >= params.adxThreshold;
    const trendBear = hFast < hSlow && hAdxVal >= params.adxThreshold;
    if (trendBull) stateCounts.htf_bull += 1;
    if (trendBear) stateCounts.htf_bear += 1;
    const regime = calcRegime(trendBull, trendBear);

    if (openPosition) {
      let exitReason: Trade['exitReason'] | null = null;
      let exitPrice = k.close;
      if (openPosition.side === 'long') {
        if (k.low <= openPosition.stopPrice) { exitReason = 'stop'; exitPrice = openPosition.stopPrice; }
        else if (k.high >= openPosition.targetPrice) { exitReason = 'target'; exitPrice = openPosition.targetPrice; }
      } else {
        if (k.high >= openPosition.stopPrice) { exitReason = 'stop'; exitPrice = openPosition.stopPrice; }
        else if (k.low <= openPosition.targetPrice) { exitReason = 'target'; exitPrice = openPosition.targetPrice; }
      }
      if (!exitReason && params.maxBarsInTrade && i - openPosition.entryIndex >= params.maxBarsInTrade) {
        exitReason = 'time_end';
        exitPrice = k.close;
      }
      if (exitReason || i === klines.length - 1) {
        finalizeOpenPosition(trades, equityCurve, params, openPosition, i, exitPrice, exitReason ?? 'time_end', equityState, klines);
        openPosition = null;
      }
      continue;
    }

    if (!(trendBull || trendBear)) continue;
    const atrNow = atrVals[i];
    const emaNow = ltfEma[i];
    const recentSlice = klines.slice(i - params.lookbackBars, i);
    const recentLow = Math.min(...recentSlice.map((x) => x.low));
    const recentHigh = Math.max(...recentSlice.map((x) => x.high));
    const nearPullbackLong = k.low <= emaNow + atrNow * params.pullbackAtrMult && recentLow < emaNow;
    const nearPullbackShort = k.high >= emaNow - atrNow * params.pullbackAtrMult && recentHigh > emaNow;
    const bullConfirm = k.close > k.open && k.high > klines[i - 1].high && k.close > emaNow;
    const bearConfirm = k.close < k.open && k.low < klines[i - 1].low && k.close < emaNow;

    if (trendBull && nearPullbackLong && bullConfirm) {
      stateCounts.pullback_long_signal += 1;
      const entryPrice = k.close * (1 + params.slippageBps / 10000);
      const stopPrice = entryPrice - atrNow * params.stopAtrMult;
      const targetPrice = entryPrice + (entryPrice - stopPrice) * params.rrTarget;
      openPosition = { strategy: 'trend_pullback', side: 'long', setup: 'pullback_long', regime, entryIndex: i, entryPrice, stopPrice, targetPrice };
      continue;
    }
    if (trendBear && nearPullbackShort && bearConfirm) {
      stateCounts.pullback_short_signal += 1;
      const entryPrice = k.close * (1 - params.slippageBps / 10000);
      const stopPrice = entryPrice + atrNow * params.stopAtrMult;
      const targetPrice = entryPrice - (stopPrice - entryPrice) * params.rrTarget;
      openPosition = { strategy: 'trend_pullback', side: 'short', setup: 'pullback_short', regime, entryIndex: i, entryPrice, stopPrice, targetPrice };
    }
  }

  return buildResponse(klines, params, trades, equityCurve, equityState.equity, stateCounts);
}

function runSnrFvgLqTc(klines: Kline[], params: BacktestParams): BacktestResponse {
  const closes = klines.map((k) => k.close);
  const highs = klines.map((k) => k.high);
  const lows = klines.map((k) => k.low);
  const volumes = klines.map((k) => k.volume);
  const ema50 = ema(closes, 50);
  const ema200 = ema(closes, 200);
  const atrVals = atr(klines, params.atrLength);
  const adxVals = adx(klines, params.adxLength);
  const vma20 = ema(volumes, 20);
  const fvgMaxHits = params.fvgMaxHits ?? 2;

  const upMoves = highs.map((h, i) => (i === 0 ? 0 : h - highs[i - 1]));
  const downMoves = lows.map((l, i) => (i === 0 ? 0 : lows[i - 1] - l));
  const plusDM = upMoves.map((u, i) => (u > downMoves[i] && u > 0 ? u : 0));
  const minusDM = downMoves.map((d, i) => (d > upMoves[i] && d > 0 ? d : 0));
  const trList = klines.map((k, i) => i === 0 ? k.high - k.low : Math.max(k.high - k.low, Math.abs(k.high - closes[i - 1]), Math.abs(k.low - closes[i - 1])));
  const trRma = rma(trList, params.adxLength);
  const plusRma = rma(plusDM, params.adxLength);
  const minusRma = rma(minusDM, params.adxLength);
  const pDi = plusDM.map((_, i) => trRma[i] === 0 ? 0 : (100 * plusRma[i]) / trRma[i]);
  const nDi = minusDM.map((_, i) => trRma[i] === 0 ? 0 : (100 * minusRma[i]) / trRma[i]);

  const snrActive: ZoneSNR[] = [];
  const fvgActive: ZoneFVG[] = [];
  const trades: Trade[] = [];
  const equityCurve: BacktestResponse['equityCurve'] = [];
  const equityState = { equity: 100, peak: 100 };
  const stateCounts: Record<string, number> = {};
  const bump = (key: string) => { stateCounts[key] = (stateCounts[key] ?? 0) + 1; };
  let openPosition: OpenPosition | null = null;
  let pendingSignal: PendingSignal | null = null;
  let lastSig = -999999;
  let lastSupBreak = -999999;
  let lastResBreak = -999999;
  let lastBullFvgTap = -999999;
  let lastBearFvgTap = -999999;
  let smcTrend = 0;
  const strength = params.snrStrength;
  const startIndex = Math.max(strength * 2 + 3, 10);

  for (let i = startIndex; i < klines.length; i += 1) {
    const k = klines[i];
    const atrNow = atrVals[i];
    const isTrend = adxVals[i] > params.adxThreshold;
    const trendBull = ema50[i] > ema200[i] && isTrend;
    const trendBear = ema50[i] < ema200[i] && isTrend;
    const regime = calcRegime(trendBull, trendBear);

    if (!openPosition && pendingSignal) {
      const ps = pendingSignal;
      const filled = maybeFillPending(ps, k, i, params);
      if (filled) {
        bump(`pending_fill_${filled.side}`);
        openPosition = filled;
        pendingSignal = null;
      } else if (i > (ps as PendingSignal).expiresAt) {
        bump('pending_expired');
        pendingSignal = null;
      }
    }

    const pivotIdx = i - strength;
    if (pivotIdx - strength >= 0) {
      let isPivotHigh = true;
      let isPivotLow = true;
      for (let j = pivotIdx - strength; j <= pivotIdx + strength; j += 1) {
        if (j < 0 || j >= klines.length || j === pivotIdx) continue;
        if (highs[pivotIdx] <= highs[j]) isPivotHigh = false;
        if (lows[pivotIdx] >= lows[j]) isPivotLow = false;
      }
      if (isPivotHigh) { snrActive.push({ wickY: highs[pivotIdx], bodyY: Math.max(klines[pivotIdx].open, klines[pivotIdx].close), startBar: pivotIdx, isRes: true }); bump('snr_new_res'); }
      if (isPivotLow) { snrActive.push({ wickY: lows[pivotIdx], bodyY: Math.min(klines[pivotIdx].open, klines[pivotIdx].close), startBar: pivotIdx, isRes: false }); bump('snr_new_sup'); }
    }

    if (i >= 2) {
      const bullGap = k.low > highs[i - 2] && ((k.low - highs[i - 2]) / k.close) * 100 > params.fvgMinSizePct && volumes[i - 1] > vma20[i] * params.volumeThreshold;
      if (bullGap) {
        fvgActive.push({ top: k.low, bottom: highs[i - 2], mid: (k.low + highs[i - 2]) / 2, startBar: i, isBull: true, hitCount: 0, maxFillRatio: 0 });
        bump('fvg_new_bull');
      }
      const bearGap = k.high < lows[i - 2] && ((lows[i - 2] - k.high) / k.close) * 100 > params.fvgMinSizePct && volumes[i - 1] > vma20[i] * params.volumeThreshold;
      if (bearGap) {
        fvgActive.push({ top: lows[i - 2], bottom: k.high, mid: (lows[i - 2] + k.high) / 2, startBar: i, isBull: false, hitCount: 0, maxFillRatio: 0 });
        bump('fvg_new_bear');
      }
    }

    let inBull = false;
    let inBear = false;
    let bestBullFill = 0;
    let bestBearFill = 0;

    for (let z = snrActive.length - 1; z >= 0; z -= 1) {
      const s = snrActive[z];
      if (i <= s.startBar) continue;
      const buffer = atrNow * params.zoneAtrBuffer;
      const bHit = k.high >= (s.bodyY - buffer) && k.low <= (s.bodyY + buffer);
      const bBreak = s.isRes ? k.close > s.bodyY : k.close < s.bodyY;
      if (bBreak) {
        if (s.isRes) { lastResBreak = i; smcTrend = 1; bump('snr_res_break'); }
        else { lastSupBreak = i; smcTrend = -1; bump('snr_sup_break'); }
      }
      if (bHit && !bBreak) {
        if (s.isRes) { inBear = true; bump('snr_touch_res'); }
        else { inBull = true; bump('snr_touch_sup'); }
      }
      const stale = i - s.startBar > params.fvgFreshnessBars * 2;
      if (stale) snrActive.splice(z, 1);
    }

    for (let z = fvgActive.length - 1; z >= 0; z -= 1) {
      const f = fvgActive[z];
      if (i <= f.startBar) continue;
      const stale = i - f.startBar > params.fvgFreshnessBars;
      const fHit = k.high >= f.bottom && k.low <= f.top;
      const fBreak = f.isBull ? k.close < f.bottom : k.close > f.top;
      let fillRatio = f.maxFillRatio;
      if (fHit) {
        const height = Math.max(Math.abs(f.top - f.bottom), 1e-9);
        const penetration = f.isBull ? Math.max(0, f.top - k.low) : Math.max(0, k.high - f.bottom);
        fillRatio = Math.max(f.maxFillRatio, Math.min(1, penetration / height));
        f.maxFillRatio = fillRatio;
        f.hitCount += 1;
        if (fillRatio >= 0.25) bump('fvg_partial_fill');
        if (fillRatio >= 0.5) bump('fvg_mid_fill');
        if (fillRatio >= 0.8) bump('fvg_deep_fill');
      }
      if (fBreak) {
        if (f.isBull) { lastSupBreak = i; smcTrend = -1; bump('fvg_bull_break'); }
        else { lastResBreak = i; smcTrend = 1; bump('fvg_bear_break'); }
      }
      if (fHit && !fBreak) {
        if (f.isBull) {
          inBull = true;
          lastBullFvgTap = i;
          bestBullFill = Math.max(bestBullFill, fillRatio);
          bump('fvg_touch_bull');
        } else {
          inBear = true;
          lastBearFvgTap = i;
          bestBearFill = Math.max(bestBearFill, fillRatio);
          bump('fvg_touch_bear');
        }
      }
      const fullyConsumed = fBreak || stale || f.hitCount > fvgMaxHits || f.maxFillRatio >= 0.95;
      if (fullyConsumed) fvgActive.splice(z, 1);
    }

    if (openPosition) {
      let exitReason: Trade['exitReason'] | null = null;
      let exitPrice = k.close;
      if (openPosition.side === 'long') {
        if (k.low <= openPosition.stopPrice) { exitReason = 'stop'; exitPrice = openPosition.stopPrice; }
        else if (k.high >= openPosition.targetPrice) { exitReason = 'target'; exitPrice = openPosition.targetPrice; }
      } else {
        if (k.high >= openPosition.stopPrice) { exitReason = 'stop'; exitPrice = openPosition.stopPrice; }
        else if (k.low <= openPosition.targetPrice) { exitReason = 'target'; exitPrice = openPosition.targetPrice; }
      }
      if (!exitReason && params.maxBarsInTrade && i - openPosition.entryIndex >= params.maxBarsInTrade) {
        exitReason = 'time_end';
        exitPrice = k.close;
      }
      if (exitReason || i === klines.length - 1) {
        finalizeOpenPosition(trades, equityCurve, params, openPosition, i, exitPrice, exitReason ?? 'time_end', equityState, klines);
        openPosition = null;
      }
      continue;
    }

    const safeBull = (i - lastSupBreak) > 2;
    const safeBear = (i - lastResBreak) > 2;
    const canSig = (i - lastSig) >= params.signalGap;
    const sweepLookback = Math.max(2, params.lqSweepLookback);
    const prevLow = Math.min(...lows.slice(Math.max(0, i - sweepLookback), i));
    const prevHigh = Math.max(...highs.slice(Math.max(0, i - sweepLookback), i));
    const bullSweep = k.low < prevLow && k.close > prevLow;
    const bullReject = k.close > k.open && k.close > closes[i - 1] && k.close > (k.low + (k.high - k.low) * 0.55);
    const bearSweep = k.high > prevHigh && k.close < prevHigh;
    const bearReject = k.close < k.open && k.close < closes[i - 1] && k.close < (k.high - (k.high - k.low) * 0.55);
    const lqBull = canSig && inBull && bullSweep && bullReject && !trendBear;
    const lqBear = canSig && inBear && bearSweep && bearReject && !trendBull;
    const tcBull = canSig && safeBull && smcTrend === 1 && pDi[i] > nDi[i] && (i - lastBullFvgTap) <= params.tcTapWindow && trendBull && k.close > k.open && k.close > Math.max(klines[i - 1].open, klines[i - 1].close);
    const tcBear = canSig && safeBear && smcTrend === -1 && nDi[i] > pDi[i] && (i - lastBearFvgTap) <= params.tcTapWindow && trendBear && k.close < k.open && k.close < Math.min(klines[i - 1].open, klines[i - 1].close);

    const makePendingEntry = (side: 'long' | 'short', baseSetup: string, fillRatio: number) => {
      const depthTag = fillRatio >= 0.75 ? 'deep' : fillRatio >= 0.4 ? 'mid' : 'shallow';
      pendingSignal = {
        strategy: 'snr_fvg_lq_tc',
        side,
        setup: `${baseSetup}_${depthTag}`,
        regime,
        signalIndex: i,
        signalPrice: k.close,
        expiresAt: i + Math.max(1, params.graceBars),
        atrAtSignal: atrNow,
      };
      bump(`${baseSetup}_signal`);
      lastSig = i;
    };

    if (!pendingSignal && lqBull) { makePendingEntry('long', 'lq_long', bestBullFill); continue; }
    if (!pendingSignal && lqBear) { makePendingEntry('short', 'lq_short', bestBearFill); continue; }
    if (!pendingSignal && tcBull) { makePendingEntry('long', 'tc_long', bestBullFill); continue; }
    if (!pendingSignal && tcBear) { makePendingEntry('short', 'tc_short', bestBearFill); continue; }
  }

  return buildResponse(klines, params, trades, equityCurve, equityState.equity, stateCounts);
}

export function runBacktest(klines: Kline[], params: BacktestParams): BacktestResponse {
  if (params.strategy === 'snr_fvg_lq_tc') return runSnrFvgLqTc(klines, params);
  return runTrendPullback(klines, params);
}
