import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDb } from "../src/db.js";
import { backupNow } from "../src/backup.js";

describe("backupNow", () => {
  it("writes a dated backup and prunes old ones", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gsd-backup-"));
    for (let d = 1; d <= 5; d++) writeFileSync(join(dir, `gsd-2026-01-0${d}.db`), "");
    const db = openDb(join(dir, "live.sqlite"));
    await backupNow(db, dir, 3, new Date("2026-11-25T12:00:00Z"));
    expect(readdirSync(dir).filter((f) => f.startsWith("gsd-")).sort()).toEqual([
      "gsd-2026-01-04.db", "gsd-2026-01-05.db", "gsd-2026-11-25.db",
    ]);
    db.close();
  });
});
