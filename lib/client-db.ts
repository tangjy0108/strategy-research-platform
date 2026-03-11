'use client';

import type { RunHistoryItem } from './types';

const STORAGE_KEY = 'srp_v32_sqlite_b64';

type SqlDatabase = {
  run: (sql: string, params?: unknown[]) => void;
  exec: (sql: string, params?: unknown[]) => unknown[];
  export: () => Uint8Array;
  prepare: (sql: string) => {
    run: (params?: unknown[]) => void;
    bind: (params?: unknown[]) => void;
    step: () => boolean;
    getAsObject: () => Record<string, unknown>;
    free: () => void;
  };
};

type SqlJsModule = {
  Database: new (data?: Uint8Array | number[]) => SqlDatabase;
};

let dbPromise: Promise<SqlDatabase | null> | null = null;
let sqlJsPromise: Promise<SqlJsModule> | null = null;

function bytesToBase64(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64: string) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function loadSqlJs(): Promise<SqlJsModule> {
  if (typeof window === 'undefined') {
    throw new Error('client-db.ts 只能在瀏覽器端使用');
  }

  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const mod = await import('sql.js/dist/sql-wasm.js');
      const initSqlJs = (mod as { default: (config: { locateFile: (file: string) => string }) => Promise<SqlJsModule> }).default;
      const SQL = await initSqlJs({
        locateFile: (file: string) => `https://sql.js.org/dist/${file}`,
      });
      return SQL;
    })();
  }

  return sqlJsPromise;
}

async function getDb() {
  if (typeof window === 'undefined') return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      const SQL = await loadSqlJs();
      const raw = localStorage.getItem(STORAGE_KEY);
      const db = raw ? new SQL.Database(base64ToBytes(raw)) : new SQL.Database();
      db.run(`
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL,
          symbol TEXT NOT NULL,
          strategy TEXT NOT NULL,
          exchange TEXT NOT NULL,
          timeframe TEXT NOT NULL,
          total_trades INTEGER NOT NULL,
          win_rate REAL NOT NULL,
          profit_factor REAL NOT NULL,
          max_drawdown_pct REAL NOT NULL,
          final_equity REAL NOT NULL,
          params_json TEXT NOT NULL,
          report_markdown TEXT NOT NULL
        )
      `);
      return db;
    })();
  }
  return dbPromise;
}

async function persistDb(db: SqlDatabase) {
  const data = db.export();
  localStorage.setItem(STORAGE_KEY, bytesToBase64(data));
}

export async function saveRunHistory(item: RunHistoryItem) {
  const db = await getDb();
  if (!db) return;
  const stmt = db.prepare(`
    INSERT OR REPLACE INTO runs
    (id, created_at, symbol, strategy, exchange, timeframe, total_trades, win_rate, profit_factor, max_drawdown_pct, final_equity, params_json, report_markdown)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run([
    item.id,
    item.createdAt,
    item.symbol,
    item.strategy,
    item.exchange,
    item.timeframe,
    item.totalTrades,
    item.winRate,
    item.profitFactor,
    item.maxDrawdownPct,
    item.finalEquity,
    item.paramsJson,
    item.reportMarkdown,
  ]);
  stmt.free();
  await persistDb(db);
}

export async function listRunHistory(limit = 20): Promise<RunHistoryItem[]> {
  const db = await getDb();
  if (!db) return [];
  const stmt = db.prepare(`
    SELECT id, created_at, symbol, strategy, exchange, timeframe, total_trades, win_rate, profit_factor, max_drawdown_pct, final_equity, params_json, report_markdown
    FROM runs
    ORDER BY created_at DESC
    LIMIT ?
  `);
  stmt.bind([limit]);
  const rows: RunHistoryItem[] = [];
  while (stmt.step()) {
    const row = stmt.getAsObject() as Record<string, unknown>;
    rows.push({
      id: String(row.id),
      createdAt: Number(row.created_at),
      symbol: String(row.symbol),
      strategy: row.strategy as RunHistoryItem['strategy'],
      exchange: row.exchange as RunHistoryItem['exchange'],
      timeframe: String(row.timeframe),
      totalTrades: Number(row.total_trades),
      winRate: Number(row.win_rate),
      profitFactor: Number(row.profit_factor),
      maxDrawdownPct: Number(row.max_drawdown_pct),
      finalEquity: Number(row.final_equity),
      paramsJson: String(row.params_json),
      reportMarkdown: String(row.report_markdown),
    });
  }
  stmt.free();
  return rows;
}
