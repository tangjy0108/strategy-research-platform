declare module 'sql.js/dist/sql-wasm.js' {
  const initSqlJs: (config: { locateFile: (file: string) => string }) => Promise<{
    Database: new (data?: Uint8Array | number[]) => {
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
  }>;

  export default initSqlJs;
}
