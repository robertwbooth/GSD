import { mkdirSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db.js";

/** Write today's backup (once per day) and keep the newest `keep` files. */
export async function backupNow(db: DB, dir: string, keep = 30, now = new Date()): Promise<string> {
  mkdirSync(dir, { recursive: true });
  const name = `gsd-${now.toISOString().slice(0, 10)}.db`;
  const path = join(dir, name);
  await db.raw.backup(path);
  const files = readdirSync(dir).filter((f) => /^gsd-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  for (const f of files.slice(0, Math.max(0, files.length - keep))) unlinkSync(join(dir, f));
  return path;
}
