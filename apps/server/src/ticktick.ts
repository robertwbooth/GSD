import { randomBytes } from "node:crypto";
import {
  apiTaskFields,
  createList,
  createTask,
  fieldsToWrite,
  HybridClock,
  INBOX_ID,
  isInboxProject,
  makeChange,
  taskIdFor,
  type SyncedFields,
  type SyncRecord,
  type Task,
  type TaskList,
  type TickTickApiProject,
  type TickTickApiTask,
} from "@gsd/core";
import type { DB } from "./db.js";

/**
 * Live sync with TickTick while Rob moves over: every 15 minutes GSD pulls new tasks and edits
 * from TickTick, and tasks ticked off in GSD are completed in TickTick too.
 */

export interface TickTickConfig {
  clientId: string;
  clientSecret: string;
  /** e.g. https://ghost-sbp.tailec0705.ts.net; used to build the OAuth redirect URL. */
  publicUrl?: string;
}

export interface TickTickStatus {
  configured: boolean;
  connected: boolean;
  lastSync: string | null;
  lastError: string | null;
  lastResult: SyncResult | null;
  redirectUrl: string | null;
}

export interface SyncResult {
  lists: number;
  created: number;
  updated: number;
  completedHere: number;
  completedThere: number;
  skippedProjects: string[];
}

const AUTH_URL = "https://ticktick.com/oauth/authorize";
const TOKEN_URL = "https://ticktick.com/oauth/token";
const API = "https://api.ticktick.com/open/v1";
const SCOPE = "tasks:read tasks:write";
const K = {
  token: "ticktick.token",
  state: "ticktick.state",
  connectedAt: "ticktick.connectedAt",
  zone: "ticktick.zone",
  lastSync: "ticktick.lastSync",
  lastError: "ticktick.lastError",
  lastResult: "ticktick.lastResult",
  pushed: "ticktick.pushed",
  project: (id: string) => `ticktick.project.${id}`,
};

export class TickTickError extends Error {
  constructor(message: string, public status = 0) {
    super(message);
  }
}

export function createTickTickSync(db: DB, cfg: TickTickConfig | null, fetchImpl: typeof fetch = fetch) {
  const clock = new HybridClock("ticktick");
  const seenGet = db.raw.prepare<[string], { project_id: string; fields: string }>("SELECT project_id, fields FROM ticktick_seen WHERE task_id = ?");
  const seenAll = db.raw.prepare<[], { task_id: string; project_id: string }>("SELECT task_id, project_id FROM ticktick_seen");
  const seenPut = db.raw.prepare("INSERT INTO ticktick_seen(task_id, project_id, fields) VALUES(?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET project_id = excluded.project_id, fields = excluded.fields");
  const seenDel = db.raw.prepare("DELETE FROM ticktick_seen WHERE task_id = ?");
  let running: Promise<SyncResult> | null = null;

  function redirectUrl(origin?: string): string | null {
    const base = (cfg?.publicUrl || origin || "").replace(/\/+$/, "");
    return base ? `${base}/api/ticktick/callback` : null;
  }

  function status(origin?: string): TickTickStatus {
    const last = db.meta.get(K.lastResult);
    return {
      configured: !!cfg,
      connected: !!db.meta.get(K.token),
      lastSync: db.meta.get(K.lastSync) ?? null,
      lastError: db.meta.get(K.lastError) ?? null,
      lastResult: last ? (JSON.parse(last) as SyncResult) : null,
      redirectUrl: cfg ? redirectUrl(origin) : null,
    };
  }

  /** Start OAuth: remember a one-time state and the zone dates are shown in. */
  function authorizeUrl(origin: string | undefined, displayZone: string): string {
    if (!cfg) throw new TickTickError("TickTick isn't set up on the server yet.");
    const redirect = redirectUrl(origin);
    if (!redirect) throw new TickTickError("Set GSD_PUBLIC_URL so TickTick knows where to send you back.");
    const state = randomBytes(16).toString("hex");
    db.meta.set(K.state, JSON.stringify({ state, redirect, at: Date.now() }));
    db.meta.set(K.zone, displayZone);
    const q = new URLSearchParams({ client_id: cfg.clientId, scope: SCOPE, state, redirect_uri: redirect, response_type: "code" });
    return `${AUTH_URL}?${q}`;
  }

  async function finishAuth(code: string, state: string): Promise<void> {
    if (!cfg) throw new TickTickError("TickTick isn't set up on the server yet.");
    const saved = db.meta.get(K.state);
    const s = saved ? (JSON.parse(saved) as { state: string; redirect: string; at: number }) : null;
    db.meta.delete(K.state);
    if (!s || s.state !== state || Date.now() - s.at > 15 * 60_000) throw new TickTickError("That sign-in link expired. Try Connect again.");
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({ code, grant_type: "authorization_code", scope: SCOPE, redirect_uri: s.redirect }).toString(),
    });
    const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
    if (!res.ok || !body.access_token) throw new TickTickError(body.error_description ?? `TickTick sign-in failed (${res.status})`, res.status);
    db.meta.set(K.token, JSON.stringify({ accessToken: body.access_token, expiresAt: body.expires_in ? Date.now() + body.expires_in * 1000 : null }));
    if (!db.meta.get(K.connectedAt)) db.meta.set(K.connectedAt, new Date().toISOString());
    db.meta.delete(K.lastError);
  }

  function disconnect() {
    db.meta.delete(K.token);
    db.meta.delete(K.connectedAt);
    db.meta.delete(K.lastError);
  }

  async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const saved = db.meta.get(K.token);
    if (!saved) throw new TickTickError("Not connected to TickTick.");
    const { accessToken } = JSON.parse(saved) as { accessToken: string };
    const res = await fetchImpl(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    if (res.status === 401) throw new TickTickError("TickTick sign-in expired. Press Connect TickTick again.", 401);
    if (!res.ok) throw new TickTickError(`TickTick returned ${res.status} for ${path.split("/").slice(0, 3).join("/")}`, res.status);
    const text = await res.text();
    return (text ? JSON.parse(text) : null) as T;
  }

  function write(type: SyncRecord["type"], id: string, fields: Record<string, unknown>) {
    if (Object.keys(fields).length) db.push([makeChange(type, id, fields, clock.tick())]);
  }

  async function syncOnce(): Promise<SyncResult> {
    const zone = db.meta.get(K.zone) ?? "UTC";
    const connectedAt = db.meta.get(K.connectedAt) ?? new Date().toISOString();
    const result: SyncResult = { lists: 0, created: 0, updated: 0, completedHere: 0, completedThere: 0, skippedProjects: [] };

    // 1. Read every task list, plus the Inbox (not in the project list).
    const projects = (await api<TickTickApiProject[]>("/project")).filter((p) => !p.closed && p.kind !== "NOTE");
    const lists = db.all<TaskList>("list").filter((l) => !l.deleted);
    const listFor = new Map<string, string>(); // TickTick project id -> GSD list id
    for (const p of projects) {
      let listId = db.meta.get(K.project(p.id));
      if (!listId || !lists.some((l) => l.id === listId)) {
        listId = lists.find((l) => l.name === p.name)?.id;
        if (!listId) {
          const list = { ...createList({ name: p.name }), id: `ttp-${p.id}`, sourceId: `ticktick-project:${p.id}` };
          write("list", list.id, list as unknown as Record<string, unknown>);
          listId = list.id;
        }
        db.meta.set(K.project(p.id), listId);
      }
      listFor.set(p.id, listId);
    }
    result.lists = listFor.size;

    const open = new Map<string, TickTickApiTask>(); // GSD id -> TickTick task
    const fetched = new Set<string>(); // GSD list ids whose TickTick project was read completely
    const read = async (projectId: string, listId: string, label: string) => {
      try {
        const data = await api<{ tasks?: TickTickApiTask[] }>(`/project/${encodeURIComponent(projectId)}/data`);
        for (const t of data?.tasks ?? []) if ((t.status ?? 0) === 0) open.set(taskIdFor(t.id), t);
        fetched.add(listId);
      } catch (e) {
        if (e instanceof TickTickError && e.status === 401) throw e;
        result.skippedProjects.push(label);
      }
    };
    for (const p of projects) await read(p.id, listFor.get(p.id)!, p.name);
    await read("inbox", INBOX_ID, "Inbox");

    const tasks = new Map(db.all<Task>("task").map((t) => [t.id, t]));
    const tickTickId = (t: Task) => (t.sourceId?.startsWith("ticktick:") ? t.sourceId.slice(9) : null);

    // 2. Ticks in GSD since connecting complete the task in TickTick. A repeating task leaves a
    //    completed copy with the same sourceId; a one-off task is completed itself.
    const pushed = new Set<string>(JSON.parse(db.meta.get(K.pushed) ?? "[]") as string[]);
    const justCompleted = new Set<string>();
    for (const t of tasks.values()) {
      const ttId = tickTickId(t);
      if (!ttId || t.deleted || t.status !== "completed" || pushed.has(t.id)) continue;
      if (!t.completedAt || t.completedAt < connectedAt) continue;
      const live = open.get(taskIdFor(ttId));
      if (!live) { pushed.add(t.id); continue; }
      await api(`/project/${encodeURIComponent(live.projectId)}/task/${encodeURIComponent(live.id)}/complete`, { method: "POST" });
      pushed.add(t.id);
      justCompleted.add(taskIdFor(ttId));
      result.completedThere++;
    }
    db.meta.set(K.pushed, JSON.stringify([...pushed].slice(-5000)));

    // 3. Pull new tasks and TickTick-side edits.
    for (const [id, t] of open) {
      if (justCompleted.has(id)) continue; // TickTick has just moved it on; read it next time
      const listId = isInboxProject(t.projectId) ? INBOX_ID : listFor.get(t.projectId);
      if (!listId) continue;
      const next = apiTaskFields(t, { listId, displayZone: zone });
      const seen = seenGet.get(id);
      const previous = seen ? (JSON.parse(seen.fields) as SyncedFields) : null;
      const current = tasks.get(id);
      if (!current) {
        const task = createTask({ ...next, title: next.title || "Untitled", parentId: next.parentId ?? null }, new Date());
        write("task", id, { ...task, id, sourceId: `ticktick:${t.id}`, sortOrder: t.sortOrder ?? task.sortOrder } as unknown as Record<string, unknown>);
        result.created++;
      } else if (!current.deleted && current.status === "open") {
        const changes = fieldsToWrite(next, previous, current);
        if (Object.keys(changes).length) {
          write("task", id, changes as Record<string, unknown>);
          result.updated++;
        }
      }
      seenPut.run(id, t.projectId, JSON.stringify(next));
    }

    // 4. Open GSD tasks from TickTick that are no longer open there were completed (or deleted) in
    //    TickTick. Only lists read completely count, so a failed read never completes anything.
    const apiHasParents = [...open.values()].some((t) => t.parentId !== undefined);
    const gone: Task[] = [];
    for (const t of tasks.values()) {
      if (!tickTickId(t) || t.deleted || t.status !== "open" || open.has(t.id) || justCompleted.has(t.id)) continue;
      if (!fetched.has(t.listId)) continue;
      if (t.parentId && !apiHasParents) continue; // can't tell subtasks apart, so leave them
      gone.push(t);
    }
    const stillOpen = [...tasks.values()].filter((t) => tickTickId(t) && !t.deleted && t.status === "open").length;
    if (gone.length > 50 && gone.length > stillOpen * 0.5) {
      throw new TickTickError(`TickTick returned far fewer tasks than expected (${gone.length} would be marked done), so nothing was changed.`);
    }
    const now = new Date().toISOString();
    for (const t of gone) {
      write("task", t.id, { status: "completed", completedAt: now });
      result.completedHere++;
    }
    for (const row of seenAll.all()) if (!open.has(row.task_id)) seenDel.run(row.task_id);

    return result;
  }

  /** Run one sync, recording the outcome. Concurrent calls share one run. */
  function sync(): Promise<SyncResult> {
    if (!cfg || !db.meta.get(K.token)) return Promise.reject(new TickTickError("Not connected to TickTick."));
    if (running) return running;
    running = syncOnce()
      .then((r) => {
        db.meta.set(K.lastSync, new Date().toISOString());
        db.meta.set(K.lastResult, JSON.stringify(r));
        db.meta.delete(K.lastError);
        return r;
      })
      .catch((e: Error) => {
        db.meta.set(K.lastError, e.message);
        throw e;
      })
      .finally(() => { running = null; });
    return running;
  }

  return { status, authorizeUrl, finishAuth, disconnect, sync, isConnected: () => !!cfg && !!db.meta.get(K.token) };
}
