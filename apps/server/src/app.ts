import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import Fastify, { type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import type { SyncRecord } from "@gsd/core";
import { openDb } from "./db.js";
import { createIssue, type GitHubConfig } from "./github.js";
import { backupNow } from "./backup.js";

export interface AppOptions {
  dbPath: string;
  password: string;
  webDir?: string;
  github?: GitHubConfig | null;
  fetchImpl?: typeof fetch;
  logger?: boolean;
  version?: string;
  /** Folder for daily database backups; none when unset. */
  backupDir?: string;
}

const ENTITY_TYPES = new Set(["task", "list", "section", "folder", "filter"]);
const FEEDBACK_KINDS = new Set(["bug", "idea", "change"]);

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

function safeEqual(a: string, b: string): boolean {
  const ha = Buffer.from(sha256(a), "hex");
  const hb = Buffer.from(sha256(b), "hex");
  return timingSafeEqual(ha, hb);
}

function isValidRecord(r: unknown): r is SyncRecord {
  if (!r || typeof r !== "object") return false;
  const x = r as Record<string, unknown>;
  return (
    typeof x.id === "string" && x.id.length > 0 && x.id.length <= 64 &&
    typeof x.type === "string" && ENTITY_TYPES.has(x.type) &&
    !!x.data && typeof x.data === "object" &&
    !!x.clocks && typeof x.clocks === "object" &&
    Object.values(x.clocks as object).every((c) => typeof c === "string")
  );
}

export async function buildApp(opts: AppOptions) {
  const db = openDb(opts.dbPath);
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 20 * 1024 * 1024 });
  app.addHook("onClose", async () => db.close());

  if (opts.backupDir) {
    const dir = opts.backupDir;
    const run = () => backupNow(db, dir).catch((e) => app.log.error(e, "backup failed"));
    void run();
    const t = setInterval(run, 24 * 60 * 60_000);
    t.unref();
    app.addHook("onClose", async () => clearInterval(t));
  }

  // --- Auth -----------------------------------------------------------------
  const failures: number[] = [];
  const findDevice = db.raw.prepare<[string], { name: string }>("SELECT name FROM devices WHERE token_hash = ?");
  const touchDevice = db.raw.prepare("UPDATE devices SET last_seen = ? WHERE token_hash = ?");

  app.post("/api/login", async (req, reply) => {
    const now = Date.now();
    while (failures.length && failures[0]! < now - 15 * 60_000) failures.shift();
    if (failures.length >= 10) return reply.code(429).send({ error: "Too many attempts. Try again in 15 minutes." });

    const body = (req.body ?? {}) as { password?: unknown; device?: unknown };
    if (typeof body.password !== "string" || !safeEqual(body.password, opts.password)) {
      failures.push(now);
      return reply.code(401).send({ error: "Wrong password" });
    }
    const token = randomBytes(32).toString("hex");
    const name = typeof body.device === "string" ? body.device.slice(0, 100) : "Unknown device";
    db.raw.prepare("INSERT INTO devices(token_hash, name, created_at) VALUES(?, ?, ?)").run(sha256(token), name, new Date().toISOString());
    return { token };
  });

  async function requireAuth(req: FastifyRequest) {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const hash = sha256(token);
    if (!token || !findDevice.get(hash)) {
      const err = new Error("Not signed in") as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
    touchDevice.run(new Date().toISOString(), hash);
  }

  app.post("/api/logout", { preHandler: requireAuth }, async (req) => {
    const token = (req.headers.authorization ?? "").slice(7);
    db.raw.prepare("DELETE FROM devices WHERE token_hash = ?").run(sha256(token));
    return { ok: true };
  });

  app.get("/api/health", async () => ({ ok: true, version: opts.version ?? "dev" }));

  // --- Sync -----------------------------------------------------------------
  app.get("/api/sync", { preHandler: requireAuth }, async (req) => {
    const since = Number((req.query as { since?: string }).since ?? 0);
    return db.pull(Number.isFinite(since) ? since : 0);
  });

  app.post("/api/sync", { preHandler: requireAuth }, async (req, reply) => {
    const body = req.body as { changes?: unknown };
    if (!Array.isArray(body?.changes) || !body.changes.every(isValidRecord)) {
      return reply.code(400).send({ error: "Invalid changes" });
    }
    return { cursor: db.push(body.changes) };
  });

  // --- Feedback -------------------------------------------------------------
  const insertFeedback = db.raw.prepare(
    "INSERT INTO feedback(kind, text, context, created_at) VALUES(?, ?, ?, ?)",
  );
  const pendingFeedback = db.raw.prepare<[], FeedbackRow>(
    "SELECT * FROM feedback WHERE issue_number IS NULL ORDER BY id",
  );
  const markFiled = db.raw.prepare("UPDATE feedback SET issue_number = ?, issue_url = ?, last_error = NULL WHERE id = ?");
  const markError = db.raw.prepare("UPDATE feedback SET last_error = ? WHERE id = ?");

  interface FeedbackRow {
    id: number; kind: string; text: string; context: string; created_at: string;
    issue_number: number | null; issue_url: string | null; last_error: string | null;
  }

  async function fileFeedback(row: FeedbackRow) {
    if (!opts.github) return;
    const ctx = JSON.parse(row.context) as Record<string, string>;
    const firstLine = row.text.split("\n")[0]!.trim();
    const title = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
    const body = [
      row.text,
      "",
      "---",
      `**Type:** ${row.kind}`,
      ...Object.entries(ctx).map(([k, v]) => `**${k}:** ${v}`),
      `**Sent:** ${row.created_at}`,
      "",
      "_Sent from the GSD feedback form._",
    ].join("\n");
    try {
      const issue = await createIssue(opts.github, { title, body, labels: ["feedback", row.kind] }, opts.fetchImpl);
      markFiled.run(issue.number, issue.url, row.id);
    } catch (e) {
      markError.run(String((e as Error).message), row.id);
    }
  }

  let retrying = false;
  async function retryPending() {
    if (retrying || !opts.github) return;
    retrying = true;
    try {
      for (const row of pendingFeedback.all()) await fileFeedback(row);
    } finally {
      retrying = false;
    }
  }
  const timer = setInterval(() => void retryPending(), 5 * 60_000);
  timer.unref();
  app.addHook("onClose", async () => clearInterval(timer));

  app.post("/api/feedback", { preHandler: requireAuth }, async (req, reply) => {
    const b = (req.body ?? {}) as { kind?: unknown; text?: unknown; context?: unknown };
    if (typeof b.kind !== "string" || !FEEDBACK_KINDS.has(b.kind) || typeof b.text !== "string" || !b.text.trim()) {
      return reply.code(400).send({ error: "Feedback needs a type and some text" });
    }
    const ctx: Record<string, string> = {};
    if (b.context && typeof b.context === "object") {
      for (const [k, v] of Object.entries(b.context)) if (typeof v === "string") ctx[k.slice(0, 40)] = v.slice(0, 200);
    }
    const info = insertFeedback.run(b.kind, b.text.slice(0, 10_000), JSON.stringify(ctx), new Date().toISOString());
    const row = db.raw.prepare<[number], FeedbackRow>("SELECT * FROM feedback WHERE id = ?").get(Number(info.lastInsertRowid))!;
    await fileFeedback(row);
    return toFeedbackJson(db.raw.prepare<[number], FeedbackRow>("SELECT * FROM feedback WHERE id = ?").get(row.id)!);
  });

  app.get("/api/feedback", { preHandler: requireAuth }, async () => {
    void retryPending();
    const rows = db.raw.prepare<[], FeedbackRow>("SELECT * FROM feedback ORDER BY id DESC LIMIT 200").all();
    return { items: rows.map(toFeedbackJson), githubConfigured: !!opts.github };
  });

  function toFeedbackJson(r: FeedbackRow) {
    return {
      id: r.id, kind: r.kind, text: r.text, createdAt: r.created_at,
      issueNumber: r.issue_number, issueUrl: r.issue_url,
      status: r.issue_number ? "filed" : opts.github ? (r.last_error ? "retrying" : "queued") : "saved",
      error: r.last_error,
    };
  }

  // --- Web app --------------------------------------------------------------
  if (opts.webDir && existsSync(opts.webDir)) {
    await app.register(fastifyStatic, { root: opts.webDir, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith("/api/")) return reply.code(404).send({ error: "Not found" });
      return reply.sendFile("index.html");
    });
  }

  return app;
}
