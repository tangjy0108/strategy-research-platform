'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, BarChart2, Check, ChevronDown, ChevronUp, Clipboard,
  Download, FileText, FlaskConical, History, Play,
  Search, Settings2, Star, TrendingUp, X, Zap,
} from 'lucide-react';
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import {
  BacktestParams, BacktestResponse, RunHistoryItem,
  ScanParamKey, ScanParamKeyTP, ScanParamKeySNR,
  ScanResponse, StrategyId, Trade,
} from '@/lib/types';
import { downloadPdfReport } from '@/lib/pdf';
import { listRunHistory, saveRunHistory } from '@/lib/client-db';

// ─── helpers ─────────────────────────────────────────────────────────────────
const fmt   = (v: number, d = 2) => Number.isFinite(v) ? v.toFixed(d) : '–';
const parseNums = (v: string) => v.split(',').map(x => Number(x.trim())).filter(x => Number.isFinite(x));
const stratLabel = (s: StrategyId) => s === 'trend_pullback' ? 'HTF Trend + Pullback' : 'SNR + FVG + LQ / TC';
const dlText = (name: string, content: string) => {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  Object.assign(document.createElement('a'), { href: url, download: name }).click();
  URL.revokeObjectURL(url);
};

type BRow     = { key: string; trades: number; winRate: number; profitFactor: number; avgR: number };
type BSection = { title: string; rows: BRow[] };
type Tab      = 'config' | 'backtest' | 'lab' | 'history' | 'report';

// ─── param lab keys per strategy ─────────────────────────────────────────────
const SCAN_KEYS_TP: { value: ScanParamKeyTP; label: string }[] = [
  { value: 'adxThreshold',   label: 'ADX Threshold'  },
  { value: 'rrTarget',       label: 'RR Target'       },
  { value: 'stopAtrMult',    label: 'Stop ATR Mult'   },
  { value: 'pullbackAtrMult',label: 'Pullback ATR'    },
  { value: 'htfFastEma',     label: 'HTF Fast EMA'   },
  { value: 'htfSlowEma',     label: 'HTF Slow EMA'   },
];
const SCAN_KEYS_SNR: { value: ScanParamKeySNR; label: string }[] = [
  { value: 'rrTarget',       label: 'RR Target'       },
  { value: 'snrStrength',    label: 'SNR Strength'    },
  { value: 'stopAtrMult',    label: 'Stop ATR Mult'   },
  { value: 'signalGap',      label: 'Signal Gap'      },
  { value: 'volumeThreshold',label: 'Vol Threshold'   },
  { value: 'fvgMinSizePct',  label: 'FVG Min Size %'  },
];

// ─── defaults ────────────────────────────────────────────────────────────────
const DEF: BacktestParams = {
  strategy: 'trend_pullback', exchange: 'binance', symbol: 'BTCUSDT',
  timeframe: '15m', limit: 800, feeBps: 4, slippageBps: 2,
  atrLength: 14, stopAtrMult: 1, rrTarget: 2, maxBarsInTrade: 80,
  htfTimeframe: '1h', htfFastEma: 50, htfSlowEma: 200,
  ltfEma: 20, adxLength: 14, adxThreshold: 20, pullbackAtrMult: 0.6, lookbackBars: 5,
  snrStrength: 15, fvgMinSizePct: 0.05, volumeThreshold: 1.1,
  signalGap: 3, graceBars: 5, lqSweepLookback: 5, tcTapWindow: 3,
  fvgFreshnessBars: 20, zoneAtrBuffer: 0.15, fvgMaxHits: 2,
  scanXKey: 'adxThreshold', scanYKey: 'rrTarget',
  scanXValues: [18, 20, 22, 25], scanYValues: [1.5, 2, 2.5, 3],
};

// popular USDT pairs to seed the list
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','SOLUSDT','BNBUSDT','XRPUSDT','ADAUSDT','DOGEUSDT',
  'AVAXUSDT','DOTUSDT','LINKUSDT','LTCUSDT','UNIUSDT','ATOMUSDT','NEARUSDT',
  'AAVEUSDT','MATICUSDT','TRXUSDT','FTMUSDT','PEPEUSDT','SHIBUSDT','WIFUSDT',
  'SUIUSDT','APTUSDT','ARBUSDT','OPUSDT','INJUSDT','TIAUSDT','STXUSDT',
  'RUNEUSDT','LDOUSDT','FETUSDT','RENDERUSDT','WLDUSDT','BONKUSDT','FLOKIUSDT',
];

// ─── atomic UI (light) ───────────────────────────────────────────────────────
const inputCls  = "w-full bg-white border border-slate-200 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 text-slate-800 text-xs rounded-lg px-3 py-2 outline-none transition-all placeholder-slate-400";
const selectCls = `${inputCls} appearance-none cursor-pointer pr-7`;

function FF({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] text-slate-500 mb-1 font-semibold uppercase tracking-wide">{label}</label>
      {children}
    </div>
  );
}
function Inp({ value, onChange, type = 'text', step }: {
  value: string | number; onChange: (v: string) => void; type?: string; step?: string;
}) {
  return <input className={inputCls} type={type} step={step} value={value}
    onChange={(e: React.ChangeEvent<HTMLInputElement>) => onChange(e.target.value)} />;
}
function Sel({ value, onChange, opts }: {
  value: string; onChange: (v: string) => void;
  opts: { value: string; label: string }[];
}) {
  return (
    <div className="relative">
      <select className={selectCls} value={value}
        onChange={(e: React.ChangeEvent<HTMLSelectElement>) => onChange(e.target.value)}>
        {opts.map((o: { value: string; label: string }) =>
          <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <ChevronDown className="w-3 h-3 text-slate-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
    </div>
  );
}
function SectionHd({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="w-3.5 h-3.5 text-blue-500" />
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{title}</span>
    </div>
  );
}
function Kpi({ label, value, sub, color = 'text-slate-800' }: {
  label: string; value: string | number; sub?: string; color?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
      <div className="text-[10px] text-slate-500 mb-1.5 uppercase tracking-wide font-medium">{label}</div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-1">{sub}</div>}
    </div>
  );
}
function Empty({ icon: Icon, msg }: { icon: React.ElementType; msg: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 text-center space-y-3">
      <div className="w-14 h-14 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center">
        <Icon className="w-6 h-6 text-slate-400" />
      </div>
      <p className="text-sm text-slate-500 max-w-xs leading-relaxed">{msg}</p>
    </div>
  );
}

// ─── Symbol Search ────────────────────────────────────────────────────────────
function SymbolSearch({ value, onChange }: { value: string; onChange: (s: string) => void }) {
  const [open, setOpen]   = useState(false);
  const [query, setQuery] = useState('');
  const [symbols, setSymbols] = useState<string[]>(POPULAR_SYMBOLS);
  const [favs, setFavs]   = useState<string[]>(['BTCUSDT','ETHUSDT','SOLUSDT']);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try { setFavs(JSON.parse(localStorage.getItem('srp_favs') || '["BTCUSDT","ETHUSDT","SOLUSDT"]')); } catch {}
    // fetch all Binance USDT pairs
    fetch('https://data-api.binance.vision/api/v3/ticker/price').then(r => r.ok ? r.json() : null).then(data => {
      if (Array.isArray(data)) {
        const all = data.filter((s: any) => s.symbol?.endsWith('USDT')).map((s: any) => s.symbol as string);
        setSymbols(Array.from(new Set([...POPULAR_SYMBOLS, ...all])));
      }
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) { setOpen(false); setQuery(''); } };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const filtered = useMemo(() => {
    const q = query.toUpperCase().trim();
    const list = q ? symbols.filter(s => s.includes(q)) : symbols;
    return list.sort((a, b) => {
      const af = favs.includes(a), bf = favs.includes(b);
      if (af && !bf) return -1; if (!af && bf) return 1;
      return a.localeCompare(b);
    }).slice(0, 80);
  }, [query, symbols, favs]);

  const toggleFav = (e: React.MouseEvent, s: string) => {
    e.stopPropagation();
    const next = favs.includes(s) ? favs.filter(f => f !== s) : [...favs, s];
    setFavs(next);
    try { localStorage.setItem('srp_favs', JSON.stringify(next)); } catch {}
  };
  const select = (s: string) => { onChange(s); setOpen(false); setQuery(''); };

  return (
    <div className="relative" ref={ref}>
      <div className="relative">
        <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          className={`${inputCls} pl-8 pr-8 font-semibold`}
          value={open ? query : value}
          placeholder="搜尋幣種..."
          onChange={e => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={e => {
            if (e.key === 'Enter' && filtered.length > 0) select(filtered[0]);
            if (e.key === 'Escape') { setOpen(false); setQuery(''); }
          }}
        />
        {open && query && (
          <button onClick={() => { setQuery(''); setOpen(false); }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
            <X className="w-3 h-3" />
          </button>
        )}
      </div>
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 z-50 bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {filtered.length === 0 && (
              <div className="px-4 py-3 text-xs text-slate-400 text-center">找不到符合的幣種</div>
            )}
            {filtered.map(s => (
              <button key={s} onClick={() => select(s)}
                className={`w-full flex items-center justify-between px-3 py-2 text-xs text-left transition-colors ${
                  s === value ? 'bg-blue-50 text-blue-600 font-semibold' : 'text-slate-700 hover:bg-slate-50'}`}>
                {s}
                <Star onClick={e => toggleFav(e, s)}
                  className={`w-3.5 h-3.5 shrink-0 ${favs.includes(s) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 hover:text-slate-500'}`} />
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Copy Button ──────────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); } catch { /* fallback */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button onClick={copy}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border transition-all ${
        copied
          ? 'bg-green-50 border-green-200 text-green-600'
          : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300 hover:text-blue-600'
      }`}>
      {copied ? <><Check className="w-3.5 h-3.5" />複製成功</> : <><Clipboard className="w-3.5 h-3.5" />複製給 AI</>}
    </button>
  );
}

// ─── Params panel (shared between sidebar & config tab) ──────────────────────
function ParamsPanel({
  params, sp, scanXText, setScanXText, scanYText, setScanYText, isConfigTab = false,
}: {
  params: BacktestParams;
  sp: (k: keyof BacktestParams, v: unknown) => void;
  scanXText: string; setScanXText: (v: string) => void;
  scanYText: string; setScanYText: (v: string) => void;
  isConfigTab?: boolean;
}) {
  const scanKeys = params.strategy === 'trend_pullback'
    ? SCAN_KEYS_TP as { value: ScanParamKey; label: string }[]
    : SCAN_KEYS_SNR as { value: ScanParamKey; label: string }[];

  // safe default for scanXKey/scanYKey if strategy switched
  const safeXKey = (scanKeys.find(k => k.value === params.scanXKey) ? params.scanXKey : scanKeys[0].value) as ScanParamKey;
  const safeYKey = (scanKeys.find(k => k.value === params.scanYKey) ? params.scanYKey : scanKeys[1].value) as ScanParamKey;

  const card = isConfigTab
    ? "bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-3"
    : "space-y-3";

  return (
    <>
      {/* Core */}
      <div className={card}>
        {isConfigTab && <SectionHd icon={Settings2} title="Strategy Config" />}
        <FF label="Strategy">
          <Sel value={params.strategy} onChange={v => sp('strategy', v as StrategyId)}
            opts={[
              { value: 'trend_pullback', label: 'HTF Trend + Pullback' },
              { value: 'snr_fvg_lq_tc',  label: 'SNR + FVG + LQ / TC' },
            ]} />
        </FF>
        <div className="grid grid-cols-2 gap-2">
          <FF label="Exchange">
            <Sel value={params.exchange} onChange={v => sp('exchange', v as BacktestParams['exchange'])}
              opts={[{ value: 'binance', label: 'Binance' }, { value: 'okx', label: 'OKX' }]} />
          </FF>
          <FF label="Timeframe">
            <Sel value={params.timeframe} onChange={v => sp('timeframe', v as BacktestParams['timeframe'])}
              opts={['5m','15m','1h','4h'].map(v => ({ value: v, label: v }))} />
          </FF>
        </div>
        <FF label="Symbol">
          <SymbolSearch value={params.symbol} onChange={v => sp('symbol', v)} />
        </FF>
        <div className="grid grid-cols-2 gap-2">
          <FF label="K線數量"><Inp type="number" value={params.limit ?? 800}     onChange={v => sp('limit',         Number(v))} /></FF>
          <FF label="RR Target"><Inp type="number" step="0.1" value={params.rrTarget}         onChange={v => sp('rrTarget',       Number(v))} /></FF>
          <FF label="ATR 長度"><Inp type="number" value={params.atrLength}        onChange={v => sp('atrLength',      Number(v))} /></FF>
          <FF label="Stop ATR×"><Inp type="number" step="0.1" value={params.stopAtrMult}      onChange={v => sp('stopAtrMult',    Number(v))} /></FF>
          <FF label="手續費 bps"><Inp type="number" value={params.feeBps}           onChange={v => sp('feeBps',         Number(v))} /></FF>
          <FF label="滑點 bps"><Inp type="number" value={params.slippageBps}      onChange={v => sp('slippageBps',    Number(v))} /></FF>
        </div>
      </div>

      {/* Strategy-specific */}
      <div className={card}>
        {params.strategy === 'trend_pullback' ? (
          <>
            {isConfigTab && <SectionHd icon={TrendingUp} title="Trend Pullback 參數" />}
            {!isConfigTab && <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Trend Pullback</div>}
            <div className="grid grid-cols-2 gap-2">
              <FF label="HTF 時框">
                <Sel value={params.htfTimeframe} onChange={v => sp('htfTimeframe', v as BacktestParams['htfTimeframe'])}
                  opts={[{ value: '1h', label: '1h' }, { value: '4h', label: '4h' }]} />
              </FF>
              <FF label="ADX 門檻"><Inp type="number" step="0.1" value={params.adxThreshold}    onChange={v => sp('adxThreshold',    Number(v))} /></FF>
              <FF label="HTF 快線"><Inp type="number"            value={params.htfFastEma}       onChange={v => sp('htfFastEma',      Number(v))} /></FF>
              <FF label="HTF 慢線"><Inp type="number"            value={params.htfSlowEma}       onChange={v => sp('htfSlowEma',      Number(v))} /></FF>
              <FF label="LTF EMA"> <Inp type="number"            value={params.ltfEma}           onChange={v => sp('ltfEma',          Number(v))} /></FF>
              <FF label="回調ATR×"><Inp type="number" step="0.1" value={params.pullbackAtrMult}  onChange={v => sp('pullbackAtrMult', Number(v))} /></FF>
            </div>
          </>
        ) : (
          <>
            {isConfigTab && <SectionHd icon={FlaskConical} title="SNR / FVG / LQ / TC 參數" />}
            {!isConfigTab && <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">SNR / FVG / LQ / TC</div>}
            <div className="grid grid-cols-2 gap-2">
              <FF label="SNR 強度">    <Inp type="number"             value={params.snrStrength}       onChange={v => sp('snrStrength',       Number(v))} /></FF>
              <FF label="FVG 最小%">   <Inp type="number" step="0.01" value={params.fvgMinSizePct}    onChange={v => sp('fvgMinSizePct',     Number(v))} /></FF>
              <FF label="成交量門檻">  <Inp type="number" step="0.1"  value={params.volumeThreshold}  onChange={v => sp('volumeThreshold',   Number(v))} /></FF>
              <FF label="訊號間隔">    <Inp type="number"             value={params.signalGap}         onChange={v => sp('signalGap',         Number(v))} /></FF>
              <FF label="Grace Bars">  <Inp type="number"             value={params.graceBars}         onChange={v => sp('graceBars',         Number(v))} /></FF>
              <FF label="LQ 掃蕩回溯"> <Inp type="number"             value={params.lqSweepLookback}   onChange={v => sp('lqSweepLookback',   Number(v))} /></FF>
              <FF label="TC 窗口">     <Inp type="number"             value={params.tcTapWindow}       onChange={v => sp('tcTapWindow',       Number(v))} /></FF>
              <FF label="FVG 新鮮度">  <Inp type="number"             value={params.fvgFreshnessBars}  onChange={v => sp('fvgFreshnessBars',  Number(v))} /></FF>
              <FF label="區域ATR緩衝"> <Inp type="number" step="0.01" value={params.zoneAtrBuffer}     onChange={v => sp('zoneAtrBuffer',     Number(v))} /></FF>
              <FF label="FVG最多命中"> <Inp type="number"             value={params.fvgMaxHits ?? 2}   onChange={v => sp('fvgMaxHits',        Number(v))} /></FF>
            </div>
          </>
        )}
      </div>

      {/* Param Lab */}
      <div className={card}>
        {isConfigTab && <SectionHd icon={FlaskConical} title="Parameter Lab 設定" />}
        {!isConfigTab && <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mb-2">Parameter Lab</div>}
        <div className="grid grid-cols-2 gap-2">
          <FF label="X 軸">
            <Sel value={safeXKey} onChange={v => sp('scanXKey', v as ScanParamKey)} opts={scanKeys} />
          </FF>
          <FF label="Y 軸">
            <Sel value={safeYKey} onChange={v => sp('scanYKey', v as ScanParamKey)} opts={scanKeys} />
          </FF>
        </div>
        <FF label="X 值（逗號分隔）"><Inp value={scanXText} onChange={setScanXText} /></FF>
        <FF label="Y 值（逗號分隔）"><Inp value={scanYText} onChange={setScanYText} /></FF>
      </div>
    </>
  );
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────
export default function Dashboard() {
  const [params,     setParams]     = useState<BacktestParams>(DEF);
  const [scanXText,  setScanXText]  = useState((DEF.scanXValues || []).join(', '));
  const [scanYText,  setScanYText]  = useState((DEF.scanYValues || []).join(', '));
  const [result,     setResult]     = useState<BacktestResponse | null>(null);
  const [scanResult, setScanResult] = useState<ScanResponse | null>(null);
  const [history,    setHistory]    = useState<RunHistoryItem[]>([]);
  const [loading,    setLoading]    = useState(false);
  const [scanLoad,   setScanLoad]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [tab,        setTab]        = useState<Tab>('config');
  const [heatM,      setHeatM]      = useState<'profitFactor' | 'expectancyR' | 'winRate' | 'maxDrawdownPct'>('profitFactor');
  const [tSetup,  setTSetup]  = useState('all');
  const [tSide,   setTSide]   = useState<'all' | Trade['side']>('all');
  const [tRegime, setTRegime] = useState<'all' | Trade['regime']>('all');
  const [tExit,   setTExit]   = useState<'all' | Trade['exitReason']>('all');
  const [cfgOpen, setCfgOpen] = useState(true);

  useEffect(() => { listRunHistory(20).then(setHistory).catch(() => {}); }, []);

  const sp = (k: keyof BacktestParams, v: unknown) =>
    setParams((prev: BacktestParams) => ({ ...prev, [k]: v }));

  async function runBacktest() {
    setLoading(true); setError(null);
    try {
      const payload = { ...params, scanXValues: parseNums(scanXText), scanYValues: parseNums(scanYText) };
      const res  = await fetch('/api/backtest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Backtest failed');
      setResult(json); setTab('backtest');
      const item: RunHistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
        createdAt: Date.now(), symbol: payload.symbol,
        strategy: payload.strategy, exchange: payload.exchange, timeframe: payload.timeframe,
        totalTrades: json.summary.totalTrades, winRate: json.summary.winRate,
        profitFactor: json.summary.profitFactor, maxDrawdownPct: json.summary.maxDrawdownPct,
        finalEquity: json.summary.finalEquity, paramsJson: JSON.stringify(payload),
        reportMarkdown: json.reportMarkdown,
      };
      await saveRunHistory(item);
      setHistory(await listRunHistory(20));
    } catch (e) { setError(e instanceof Error ? e.message : 'Backtest failed'); }
    finally { setLoading(false); }
  }

  async function runScan() {
    setScanLoad(true); setError(null);
    try {
      const payload = { ...params, scanXValues: parseNums(scanXText), scanYValues: parseNums(scanYText) };
      const res  = await fetch('/api/scan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Scan failed');
      setScanResult(json); setTab('lab');
    } catch (e) { setError(e instanceof Error ? e.message : 'Scan failed'); }
    finally { setScanLoad(false); }
  }

  type HeatCell = ScanResponse['cells'][number];
  const heatStats = useMemo(() => {
    const vals = (scanResult?.cells || []).map((c: HeatCell) => c[heatM as keyof HeatCell] as number);
    return { min: vals.length ? Math.min(...vals) : 0, max: vals.length ? Math.max(...vals) : 1 };
  }, [scanResult, heatM]);

  const heatColor = (v: number) => {
    const r = heatStats.max === heatStats.min ? 0.5 : Math.min(Math.max((v - heatStats.min) / (heatStats.max - heatStats.min), 0), 1);
    if (heatM === 'maxDrawdownPct') return `hsl(${120 - r * 120},70%,90%)`;
    return `hsl(${120 * r},60%,88%)`;
  };
  const heatTextColor = (v: number) => {
    const r = heatStats.max === heatStats.min ? 0.5 : Math.min(Math.max((v - heatStats.min) / (heatStats.max - heatStats.min), 0), 1);
    if (heatM === 'maxDrawdownPct') return `hsl(${120 - r * 120},50%,28%)`;
    return `hsl(${120 * r},50%,25%)`;
  };

  const bestCell = useMemo(() =>
    [...(scanResult?.cells || [])].sort((a: HeatCell, b: HeatCell) =>
      (b.profitFactor - b.maxDrawdownPct * 0.1) - (a.profitFactor - a.maxDrawdownPct * 0.1)
    )[0], [scanResult]);

  const filteredTrades = useMemo(() =>
    (result?.trades || []).filter((t: Trade) =>
      (tSetup  === 'all' || t.setup      === tSetup)  &&
      (tSide   === 'all' || t.side       === tSide)   &&
      (tRegime === 'all' || t.regime     === tRegime) &&
      (tExit   === 'all' || t.exitReason === tExit)
    ), [result, tSetup, tSide, tRegime, tExit]);

  const uniqueSetups = [...new Set((result?.trades || []).map((t: Trade) => t.setup))] as string[];

  const bSections: BSection[] = result ? [
    { title: 'Setup',  rows: result.setupBreakdown.map((r: typeof result.setupBreakdown[number])   => ({ key: r.key, trades: r.trades, winRate: r.winRate, profitFactor: r.profitFactor, avgR: r.avgR })) },
    { title: 'Regime', rows: result.regimeBreakdown.map((r: typeof result.regimeBreakdown[number]) => ({ key: r.key, trades: r.trades, winRate: r.winRate, profitFactor: r.profitFactor, avgR: r.avgR })) },
    { title: 'Exit',   rows: result.exitBreakdown.map((r: typeof result.exitBreakdown[number])     => ({ key: r.key, trades: r.trades, winRate: r.winRate, profitFactor: r.profitFactor, avgR: r.avgR })) },
    { title: 'State',  rows: result.stateBreakdown.map((r: typeof result.stateBreakdown[number])   => ({ key: r.key, trades: r.count,  winRate: 0,         profitFactor: 0,              avgR: 0       })) },
  ] : [];

  const eqData = (result?.equityCurve || []).map((pt: BacktestResponse['equityCurve'][number], i: number) =>
    ({ i, eq: pt.equity, dd: pt.drawdownPct }));

  const TABS: { id: Tab; label: string; icon: React.ElementType; badge?: number }[] = [
    { id: 'config',   label: 'Config',  icon: Settings2                       },
    { id: 'backtest', label: 'Results', icon: BarChart2                       },
    { id: 'lab',      label: 'Lab',     icon: FlaskConical                    },
    { id: 'history',  label: 'History', icon: History, badge: history.length  },
    { id: 'report',   label: 'Report',  icon: FileText                        },
  ];

  // ── Sidebar CTA section ───────────────────────────────────────────────────
  const CtaButtons = () => (
    <div className="space-y-2">
      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">{error}</div>
      )}
      <button onClick={runBacktest} disabled={loading}
        className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm font-bold px-4 py-3 rounded-xl transition-all shadow-md shadow-blue-200 active:scale-[0.98]">
        {loading
          ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />執行中…</>
          : <><Play className="w-4 h-4" />Run Backtest</>}
      </button>
      <button onClick={runScan} disabled={scanLoad}
        className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-semibold px-4 py-3 rounded-xl border border-slate-200 transition-colors shadow-sm">
        {scanLoad
          ? <><div className="w-4 h-4 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />掃描中…</>
          : <><Zap className="w-4 h-4 text-amber-500" />Run Param Lab</>}
      </button>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F0F2F5] text-slate-800 font-sans flex flex-col">

      {/* ── Header ── */}
      <header className="border-b border-slate-200 bg-white h-14 flex items-center justify-between px-5 shrink-0 z-20 shadow-sm">
        <div className="flex items-center gap-2.5 font-bold text-lg tracking-tight">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center shadow shadow-blue-200">
            <Activity className="w-5 h-5 text-white" />
          </div>
          <span className="text-slate-800">Strategy Research</span>
          <span className="hidden sm:inline text-xs font-normal text-slate-400">v3.2.3g</span>
        </div>
        <div className="flex items-center gap-2">
          {result && (
            <>
              <button onClick={() => dlText(`report-${params.symbol}.md`, result.reportMarkdown)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors">
                <Download className="w-3.5 h-3.5" />MD
              </button>
              <button onClick={() => downloadPdfReport(result)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg transition-colors">
                <Download className="w-3.5 h-3.5" />PDF
              </button>
            </>
          )}
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">

        {/* ── Desktop Sidebar ── */}
        <aside className="hidden lg:flex flex-col w-72 shrink-0 border-r border-slate-200 bg-white overflow-y-auto custom-scrollbar shadow-sm">

          {/* Strategy config collapsible */}
          <div className="border-b border-slate-100">
            <button onClick={() => setCfgOpen(o => !o)}
              className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-2">
                <Settings2 className="w-3.5 h-3.5 text-blue-500" />
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Strategy Config</span>
              </div>
              {cfgOpen ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
            </button>
            {cfgOpen && (
              <div className="px-4 pb-4">
                <ParamsPanel params={params} sp={sp} scanXText={scanXText} setScanXText={setScanXText} scanYText={scanYText} setScanYText={setScanYText} />
              </div>
            )}
          </div>

          <div className="p-4 mt-auto border-t border-slate-100">
            <CtaButtons />
          </div>
        </aside>

        {/* ── Main ── */}
        <main className="flex-1 overflow-y-auto custom-scrollbar flex flex-col min-w-0">

          {/* Tab bar */}
          <div className="border-b border-slate-200 bg-white flex items-center px-3 sm:px-5 shrink-0 overflow-x-auto custom-scrollbar shadow-sm">
            {TABS.map(({ id, label, icon: Icon, badge }) => (
              <button key={id} onClick={() => setTab(id)}
                className={`flex items-center gap-1.5 px-3 py-3.5 text-xs font-medium border-b-2 transition-colors shrink-0 ${
                  id === 'config' ? 'lg:hidden' : ''
                } ${tab === id ? 'border-blue-500 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                <Icon className="w-3.5 h-3.5" />{label}
                {badge ? <span className="ml-0.5 px-1.5 py-0.5 text-[9px] bg-slate-100 text-slate-500 rounded-full">{badge}</span> : null}
              </button>
            ))}
            <button onClick={runBacktest} disabled={loading}
              className="ml-auto shrink-0 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-bold px-3.5 py-1.5 rounded-lg transition-colors my-2 shadow shadow-blue-200">
              {loading ? <div className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" /> : <Play className="w-3 h-3" />}
              Run
            </button>
          </div>

          <div className="p-4 flex-1">

            {/* ── CONFIG tab (mobile) ── */}
            {tab === 'config' && (
              <div className="space-y-4 max-w-lg mx-auto">
                <ParamsPanel params={params} sp={sp} scanXText={scanXText} setScanXText={setScanXText} scanYText={scanYText} setScanYText={setScanYText} isConfigTab />
                <CtaButtons />
              </div>
            )}

            {/* ── RESULTS ── */}
            {tab === 'backtest' && (
              !result
                ? <Empty icon={BarChart2} msg="在左側設定參數後，點擊「Run Backtest」" />
                : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <Kpi label="Total Trades"  value={result.summary.totalTrades} sub={`K線 ${result.klinesMeta.count} 根`} />
                      <Kpi label="Win Rate"      value={`${fmt(result.summary.winRate)}%`}
                        color={result.summary.winRate >= 50 ? 'text-emerald-600' : 'text-red-500'}
                        sub={`Exp ${fmt(result.summary.expectancyR, 3)}R`} />
                      <Kpi label="Profit Factor" value={fmt(result.summary.profitFactor)}
                        color={result.summary.profitFactor >= 1.5 ? 'text-emerald-600' : result.summary.profitFactor >= 1 ? 'text-amber-600' : 'text-red-500'}
                        sub={stratLabel(result.params.strategy)} />
                      <Kpi label="Max Drawdown"  value={`${fmt(result.summary.maxDrawdownPct)}%`}
                        color="text-red-500" sub={`Final Equity ${fmt(result.summary.finalEquity)}`} />
                    </div>

                    {/* Equity Curve */}
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <SectionHd icon={TrendingUp} title="Equity Curve" />
                      <div className="h-48">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={eqData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                            <defs>
                              <linearGradient id="eqG" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#3B82F6" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}   />
                              </linearGradient>
                              <linearGradient id="ddG" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%"  stopColor="#EF4444" stopOpacity={0.15} />
                                <stop offset="95%" stopColor="#EF4444" stopOpacity={0}   />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                            <XAxis dataKey="i" hide />
                            <YAxis yAxisId="eq" domain={['auto','auto']} tick={{ fontSize: 10, fill: '#94A3B8' }} width={52} />
                            <YAxis yAxisId="dd" orientation="right" domain={[0,'auto']} tick={{ fontSize: 10, fill: '#94A3B8' }} width={36} />
                            <Tooltip contentStyle={{ background: 'white', border: '1px solid #E2E8F0', borderRadius: 8, fontSize: 11 }}
                              labelFormatter={() => ''}
                              formatter={(v: number, name: string) => [fmt(v), name === 'eq' ? 'Equity' : 'DD%']} />
                            <Area yAxisId="dd" type="monotone" dataKey="dd" stroke="#EF4444" strokeWidth={0} fill="url(#ddG)" />
                            <Area yAxisId="eq" type="monotone" dataKey="eq" stroke="#3B82F6" strokeWidth={2} fill="url(#eqG)" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Breakdown */}
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <SectionHd icon={BarChart2} title="Breakdown" />
                      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-5">
                        {bSections.map(({ title, rows }: BSection) => (
                          <div key={title}>
                            <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-2">{title}</div>
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="border-b border-slate-100">
                                  <th className="text-left text-slate-400 py-1.5 font-medium pr-2">Key</th>
                                  <th className="text-right text-slate-400 py-1.5 font-medium">N</th>
                                  <th className="text-right text-slate-400 py-1.5 font-medium">WR</th>
                                  <th className="text-right text-slate-400 py-1.5 font-medium">PF</th>
                                </tr>
                              </thead>
                              <tbody>
                                {rows.map((r: BRow) => (
                                  <tr key={r.key} className="border-b border-slate-50">
                                    <td className="py-1.5 text-slate-700 truncate max-w-[72px] pr-2">{r.key}</td>
                                    <td className="py-1.5 text-right text-slate-500">{r.trades}</td>
                                    <td className={`py-1.5 text-right ${r.winRate >= 50 ? 'text-emerald-600' : r.winRate ? 'text-red-500' : 'text-slate-400'}`}>
                                      {r.winRate ? `${fmt(r.winRate)}%` : '–'}
                                    </td>
                                    <td className={`py-1.5 text-right font-mono ${r.profitFactor >= 1.5 ? 'text-emerald-600' : r.profitFactor >= 1 ? 'text-amber-600' : r.profitFactor ? 'text-red-500' : 'text-slate-400'}`}>
                                      {r.profitFactor ? fmt(r.profitFactor) : '–'}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Trades */}
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                      <div className="flex items-center justify-between mb-3">
                        <SectionHd icon={Activity} title="Trades" />
                        <span className="text-[10px] text-slate-400">{filteredTrades.length} / {result.trades.length}</span>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                        <FF label="Setup">
                          <Sel value={tSetup} onChange={setTSetup}
                            opts={[{ value: 'all', label: 'All' }, ...(uniqueSetups as string[]).map((s: string) => ({ value: s, label: s }))]} />
                        </FF>
                        <FF label="Side">
                          <Sel value={tSide} onChange={v => setTSide(v as typeof tSide)}
                            opts={[{ value: 'all', label: 'All' }, { value: 'long', label: 'Long' }, { value: 'short', label: 'Short' }]} />
                        </FF>
                        <FF label="Regime">
                          <Sel value={tRegime} onChange={v => setTRegime(v as typeof tRegime)}
                            opts={[{ value: 'all', label: 'All' }, { value: 'trend_bull', label: 'Bull' }, { value: 'trend_bear', label: 'Bear' }, { value: 'chop', label: 'Chop' }]} />
                        </FF>
                        <FF label="Exit">
                          <Sel value={tExit} onChange={v => setTExit(v as typeof tExit)}
                            opts={[{ value: 'all', label: 'All' }, { value: 'target', label: 'Target' }, { value: 'stop', label: 'Stop' }, { value: 'time_end', label: 'Time' }]} />
                        </FF>
                      </div>
                      <div className="overflow-x-auto custom-scrollbar">
                        <table className="w-full text-xs min-w-[640px]">
                          <thead>
                            <tr className="border-b border-slate-100">
                              {['#','Setup','Side','Regime','Entry','Exit','PnL%','R','Bars','Reason'].map(h => (
                                <th key={h} className="text-left text-slate-400 py-2 px-2 font-medium whitespace-nowrap">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {filteredTrades.slice(0, 150).map((t: Trade) => (
                              <tr key={t.id} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors">
                                <td className="py-2 px-2 text-slate-400">{t.id}</td>
                                <td className="py-2 px-2 text-slate-600">{t.setup}</td>
                                <td className={`py-2 px-2 font-semibold ${t.side === 'long' ? 'text-emerald-600' : 'text-red-500'}`}>{t.side}</td>
                                <td className="py-2 px-2 text-slate-500">{t.regime}</td>
                                <td className="py-2 px-2 text-slate-400">{new Date(t.entryTime).toLocaleDateString()}</td>
                                <td className="py-2 px-2 text-slate-400">{new Date(t.exitTime).toLocaleDateString()}</td>
                                <td className={`py-2 px-2 font-mono font-semibold ${t.pnlPct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(t.pnlPct, 3)}%</td>
                                <td className={`py-2 px-2 font-mono ${t.pnlR >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(t.pnlR)}</td>
                                <td className="py-2 px-2 text-slate-400">{t.barsHeld}</td>
                                <td className="py-2 px-2">
                                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                    t.exitReason === 'target' ? 'bg-emerald-50 text-emerald-600' :
                                    t.exitReason === 'stop'   ? 'bg-red-50 text-red-500' :
                                    'bg-slate-100 text-slate-500'}`}>{t.exitReason}</span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {filteredTrades.length > 150 && (
                          <div className="text-center text-xs text-slate-400 py-2">顯示前 150 / {filteredTrades.length} 筆</div>
                        )}
                      </div>
                    </div>
                  </div>
                )
            )}

            {/* ── PARAM LAB ── */}
            {tab === 'lab' && (
              !scanResult
                ? <Empty icon={FlaskConical} msg="在左側設定 X/Y 軸與數值後，點擊「Run Param Lab」" />
                : (
                  <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                      <SectionHd icon={FlaskConical} title="Parameter Heatmap" />
                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="w-44">
                          <Sel value={heatM} onChange={v => setHeatM(v as typeof heatM)}
                            opts={[
                              { value: 'profitFactor',   label: 'Profit Factor' },
                              { value: 'expectancyR',    label: 'Expectancy R'  },
                              { value: 'winRate',        label: 'Win Rate'      },
                              { value: 'maxDrawdownPct', label: 'Max Drawdown'  },
                            ]} />
                        </div>
                        {bestCell && (
                          <div className="text-xs text-slate-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 whitespace-nowrap">
                            🏆 Best: <span className="font-semibold text-slate-800">{scanResult.xKey}={bestCell.x}, {scanResult.yKey}={bestCell.y}</span>
                            {' '}PF=<span className="text-emerald-600 font-mono">{fmt(bestCell.profitFactor)}</span>
                            {' '}DD=<span className="text-red-500 font-mono">{fmt(bestCell.maxDrawdownPct)}%</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="overflow-x-auto custom-scrollbar">
                      <div className="inline-grid gap-2"
                        style={{ gridTemplateColumns: `112px repeat(${scanResult.yValues.length}, minmax(88px, 1fr))` }}>
                        <div />
                        {scanResult.yValues.map((v: number) => (
                          <div key={`yh-${v}`} className="text-center text-[10px] text-slate-500 font-semibold py-1">
                            {scanResult.yKey}={v}
                          </div>
                        ))}
                        {scanResult.xValues.map((x: number) => (
                          <Fragment key={`row-${x}`}>
                            <div className="flex items-center text-[10px] text-slate-500 font-semibold">
                              {scanResult.xKey}={x}
                            </div>
                            {scanResult.yValues.map((y: number) => {
                              const cell = scanResult.cells.find((c: HeatCell) => c.x === x && c.y === y);
                              if (!cell) return (
                                <div key={`${x}-${y}`} className="rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-300 text-xs min-h-[76px]">–</div>
                              );
                              const isBest = bestCell?.x === x && bestCell?.y === y;
                              const metricVal = (cell as HeatCell)[heatM as keyof HeatCell] as number;
                              return (
                                <div key={`${x}-${y}`}
                                  className={`rounded-xl p-3 min-h-[76px] flex flex-col justify-between border ${isBest ? 'ring-2 ring-amber-400 border-amber-300' : 'border-transparent'}`}
                                  style={{ background: heatColor(metricVal) }}>
                                  <div className="text-lg font-bold font-mono" style={{ color: heatTextColor(metricVal) }}>{fmt(metricVal)}</div>
                                  <div className="space-y-0.5">
                                    <div className="text-[9px] text-slate-600">N={cell.totalTrades}</div>
                                    <div className="text-[9px] text-slate-600">PF={fmt(cell.profitFactor)}</div>
                                    <div className="text-[9px] text-slate-600">DD={fmt(cell.maxDrawdownPct)}%</div>
                                  </div>
                                </div>
                              );
                            })}
                          </Fragment>
                        ))}
                      </div>
                    </div>
                  </div>
                )
            )}

            {/* ── HISTORY ── */}
            {tab === 'history' && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <SectionHd icon={History} title="Run History (SQLite)" />
                <p className="text-xs text-slate-400 mb-4">最近 20 筆研究結果，儲存於瀏覽器端 sql.js。</p>
                <div className="overflow-x-auto custom-scrollbar">
                  <table className="w-full text-xs min-w-[580px]">
                    <thead>
                      <tr className="border-b border-slate-100">
                        {['Time','Symbol','Strategy','N','WR%','PF','DD%','Equity'].map(h => (
                          <th key={h} className="text-left text-slate-400 py-2 px-2 font-medium whitespace-nowrap">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((h: RunHistoryItem) => (
                        <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/50">
                          <td className="py-2 px-2 text-slate-400 whitespace-nowrap">{new Date(h.createdAt).toLocaleString()}</td>
                          <td className="py-2 px-2 font-semibold">{h.symbol}</td>
                          <td className="py-2 px-2 text-slate-500">{stratLabel(h.strategy)}</td>
                          <td className="py-2 px-2">{h.totalTrades}</td>
                          <td className={`py-2 px-2 font-mono ${h.winRate >= 50 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(h.winRate)}%</td>
                          <td className={`py-2 px-2 font-mono ${h.profitFactor >= 1.5 ? 'text-emerald-600' : h.profitFactor >= 1 ? 'text-amber-600' : 'text-red-500'}`}>{fmt(h.profitFactor)}</td>
                          <td className="py-2 px-2 font-mono text-red-500">{fmt(h.maxDrawdownPct)}%</td>
                          <td className="py-2 px-2 font-mono">{fmt(h.finalEquity)}</td>
                        </tr>
                      ))}
                      {!history.length && (
                        <tr><td colSpan={8} className="py-10 text-center text-slate-400 text-xs">尚無歷史。執行 Backtest 後自動儲存。</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ── REPORT ── */}
            {tab === 'report' && (
              <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <SectionHd icon={FileText} title="Research Report" />
                  {result && (
                    <div className="flex items-center gap-2">
                      <CopyBtn text={result.reportMarkdown} />
                      <button onClick={() => dlText(`report-${params.symbol}.md`, result.reportMarkdown)}
                        className="flex items-center gap-1.5 text-xs text-slate-600 hover:text-slate-800 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 transition-colors">
                        <Download className="w-3 h-3" />Export MD
                      </button>
                    </div>
                  )}
                </div>
                {!result
                  ? <Empty icon={FileText} msg="執行 Backtest 後自動產生詳細 Markdown 研究報告" />
                  : <pre className="text-xs text-slate-600 bg-slate-50 rounded-xl p-4 overflow-auto custom-scrollbar max-h-[calc(100vh-220px)] whitespace-pre-wrap leading-relaxed border border-slate-200 font-mono">{result.reportMarkdown}</pre>}
              </div>
            )}

          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ── */}
      <div className="lg:hidden border-t border-slate-200 bg-white flex shrink-0 shadow-[0_-1px_0_rgba(0,0,0,0.05)]">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors ${
              tab === id ? 'text-blue-600' : 'text-slate-400'}`}>
            <Icon className="w-4 h-4" />
            <span className="truncate">{label}</span>
          </button>
        ))}
      </div>

    </div>
  );
}
