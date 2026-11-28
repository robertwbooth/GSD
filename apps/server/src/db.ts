import Database from "better-sqlite3";
import { mergeRecord, type SyncRecord } from "@gsd/core";

export type DB = ReturnType<typeof openDb>;

export function openDb(path: string) {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      type TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      clocks TEXT NOT NULL,
      seq INTEGER NOT NULL,
      PRIMARY KEY (type, id)
    );
    CREATE INDEX IF NOT EXISTS records_seq ON records(seq);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (
      token_hash TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      last_seen TEXT
    );
    CREATE TABLE IF NOT EXISTS ticktick_seen (
      task_id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      fields TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL,
      text TEXT NOT NULL,
      context TEXT NOT NULL,
      created_at TEXT NOT NULL,
      issue_number INTEGER,
      issue_url TEXT,
      last_error TEXT
    );
  `);

  const getSeq = db.prepare<[], { value: string }>("SELECT value FROM meta WHERE key = 'seq'");
  const setSeq = db.prepare("INSERT INTO meta(key, value) VALUES('seq', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const getRecord = db.prepare<[string, string], { data: string; clocks: string }>(
    "SELECT data, clocks FROM records WHERE type = ? AND id = ?",
  );
  const putRecord = db.prepare(
    "INSERT INTO records(type, id, data, clocks, seq) VALUES(@type, @id, @data, @clocks, @seq) " +
      "ON CONFLICT(type, id) DO UPDATE SET data = excluded.data, clocks = excluded.clocks, seq = excluded.seq",
  );
  const since = db.prepare<[number, number], { type: string; id: string; data: string; clocks: string; seq: number }>(
    "SELECT type, id, data, clocks, seq FROM records WHERE seq > ? ORDER BY seq LIMIT ?",
  );

  const currentSeq = () => Number(getSeq.get()?.value ?? 0);

  /** Merge pushed changes. Returns the new cursor. */
  const push = db.transaction((changes: SyncRecord[]): number => {
    let seq = currentSeq();
    for (const c of changes) {
      const row = getRecord.get(c.type, c.id);
      const base: SyncRecord | undefined = row
        ? { id: c.id, type: c.type, data: JSON.parse(row.data), clocks: JSON.parse(row.clocks) }
        : undefined;
      const { record, changed } = mergeRecord(base, c);
      if (!changed) continue;
      seq++;
      putRecord.run({ type: c.type, id: c.id, data: JSON.stringify(record.data), clocks: JSON.stringify(record.clocks), seq });
    }
    setSeq.run(String(seq));
    return seq;
  });

  function pull(after: number, limit = 1000): { records: SyncRecord[]; cursor: number; more: boolean } {
    const rows = since.all(after, limit + 1);
    const more = rows.length > limit;
    const page = rows.slice(0, limit);
    return {
      records: page.map((r) => ({ type: r.type as SyncRecord["type"], id: r.id, data: JSON.parse(r.data), clocks: JSON.parse(r.clocks) })),
      cursor: page.length ? page[page.length - 1]!.seq : Math.max(after, 0),
      more,
    };
  }

  const byType = db.prepare<[string], { id: string; data: string; clocks: string }>("SELECT id, data, clocks FROM records WHERE type = ?");
  const getMeta = db.prepare<[string], { value: string }>("SELECT value FROM meta WHERE key = ?");
  const setMetaStmt = db.prepare("INSERT INTO meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value");
  const delMetaStmt = db.prepare("DELETE FROM meta WHERE key = ?");

  function get<T = Record<string, unknown>>(type: SyncRecord["type"], id: string): T | undefined {
    const row = getRecord.get(type, id);
    return row ? (JSON.parse(row.data) as T) : undefined;
  }
  function all<T = Record<string, unknown>>(type: SyncRecord["type"]): T[] {
    return byType.all(type).map((r) => JSON.parse(r.data) as T);
  }
  const meta = {
    get: (key: string) => getMeta.get(key)?.value,
    set: (key: string, value: string) => void setMetaStmt.run(key, value),
    delete: (key: string) => void delMetaStmt.run(key),
  };

  return { raw: db, push, pull, currentSeq, get, all, meta, close: () => db.close() };
}
