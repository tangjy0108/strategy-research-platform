export type Exchange = 'binance' | 'okx';
export type Timeframe = '5m' | '15m' | '1h' | '4h';
export type StrategyId = 'trend_pullback' | 'snr_fvg_lq_tc';

export type Kline = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ScanParamKeyTP =   // Trend Pullback
  | 'adxThreshold'
  | 'rrTarget'
  | 'stopAtrMult'
  | 'pullbackAtrMult'
  | 'htfFastEma'
  | 'htfSlowEma';

export type ScanParamKeySNR =  // SNR/FVG/LQ/TC
  | 'rrTarget'
  | 'snrStrength'
  | 'stopAtrMult'
  | 'signalGap'
  | 'volumeThreshold'
  | 'fvgMinSizePct';

export type ScanParamKey = ScanParamKeyTP | ScanParamKeySNR;

export type BacktestParams = {
  strategy: StrategyId;
  exchange: Exchange;
  symbol: string;
  timeframe: Timeframe;
  startTime?: number;
  endTime?: number;
  limit?: number;

  feeBps: number;
  slippageBps: number;
  atrLength: number;
  stopAtrMult: number;
  rrTarget: number;
  maxBarsInTrade?: number;

  htfTimeframe: '1h' | '4h';
  htfFastEma: number;
  htfSlowEma: number;
  ltfEma: number;
  adxLength: number;
  adxThreshold: number;
  pullbackAtrMult: number;
  lookbackBars: number;

  snrStrength: number;
  fvgMinSizePct: number;
  volumeThreshold: number;
  signalGap: number;
  graceBars: number;
  lqSweepLookback: number;
  tcTapWindow: number;
  fvgFreshnessBars: number;
  zoneAtrBuffer: number;
  fvgMaxHits?: number;

  scanXKey?: ScanParamKey;
  scanYKey?: ScanParamKey;
  scanXValues?: number[];
  scanYValues?: number[];
};

export type Trade = {
  id: number;
  strategy: StrategyId;
  setup: string;
  side: 'long' | 'short';
  regime: 'trend_bull' | 'trend_bear' | 'chop';
  entryTime: number;
  exitTime: number;
  entryPrice: number;
  exitPrice: number;
  stopPrice: number;
  targetPrice: number;
  pnlPct: number;
  pnlR: number;
  barsHeld: number;
  exitReason: 'target' | 'stop' | 'time_end';
};

export type Summary = {
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  expectancyR: number;
  avgPnlPct: number;
  maxDrawdownPct: number;
  finalEquity: number;
};

export type GroupMetric = {
  key: string;
  trades: number;
  winRate: number;
  avgR: number;
  profitFactor: number;
  avgPnlPct: number;
};

export type StateMetric = {
  key: string;
  count: number;
};

export type ScanResponse = {
  xKey: string;
  yKey: string;
  xValues: number[];
  yValues: number[];
  cells: {
    x: number;
    y: number;
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    expectancyR: number;
    maxDrawdownPct: number;
  }[];
};

export type BacktestResponse = {
  params: BacktestParams;
  summary: Summary;
  trades: Trade[];
  setupBreakdown: GroupMetric[];
  regimeBreakdown: GroupMetric[];
  exitBreakdown: GroupMetric[];
  stateBreakdown: StateMetric[];
  equityCurve: { time: number; equity: number; drawdownPct: number }[];
  reportMarkdown: string;
  klinesMeta: { count: number; firstTime: number; lastTime: number };
};

export type RunHistoryItem = {
  id: string;
  createdAt: number;
  symbol: string;
  strategy: StrategyId;
  exchange: Exchange;
  timeframe: Timeframe;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdownPct: number;
  finalEquity: number;
  paramsJson: string;
  reportMarkdown: string;
};
