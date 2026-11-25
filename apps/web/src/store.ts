import { openDB, type IDBPDatabase } from "idb";
import {
  HybridClock,
  makeChange,
  mergeRecord,
  newId,
  type EntityMap,
  type EntityType,
  type SyncRecord,
} from "@gsd/core";

/**
 * Local-first store. Every record lives in memory and in IndexedDB; edits go to an
 * outbox that is pushed to the server whenever it is reachable.
 */

// Records are stored untyped; `all`/`get` cast to the entity type on the way out.
type Records = Record<EntityType, Map<string, SyncRecord>>;

export type SyncState = "idle" | "syncing" | "offline" | "error" | "signed-out";

interface Meta {
  token: string | null;
  cursor: number;
  device: string;
}

const DB_NAME = "gsd";
let idb: IDBPDatabase | null = null;
const records: Records = { task: new Map(), list: new Map(), section: new Map(), folder: new Map(), filter: new Map() };
let outbox: SyncRecord[] = [];
let meta: Meta = { token: null, cursor: 0, device: "" };
let clock: HybridClock;
let syncState: SyncState = "idle";
let version = 0;
const listeners = new Set<() => void>();

function emit() {
  version++;
  for (const l of listeners) l();
}

export function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
export const getVersion = () => version;
export const getSyncState = () => syncState;
export const isSignedIn = () => !!meta.token;

export async function init(): Promise<void> {
  idb = await openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore("records");
      db.createObjectStore("outbox", { autoIncrement: true });
      db.createObjectStore("meta");
    },
  });
  const storedMeta = (await idb.get("meta", "meta")) as Meta | undefined;
  meta = storedMeta ?? { token: null, cursor: 0, device: newId().slice(-8) };
  if (!storedMeta) await idb.put("meta", meta, "meta");
  clock = new HybridClock(meta.device);
  const all = (await idb.getAll("records")) as SyncRecord[];
  for (const r of all) {
    records[r.type].set(r.id, r);
    for (const c of Object.values(r.clocks)) clock.observe(c);
  }
  outbox = (await idb.getAll("outbox")) as SyncRecord[];
  syncState = meta.token ? "idle" : "signed-out";
  emit();
}

export function all<K extends EntityType>(type: K): EntityMap[K][] {
  return [...records[type].values()].map((r) => r.data as unknown as EntityMap[K]);
}

export function get<K extends EntityType>(type: K, id: string): EntityMap[K] | undefined {
  return records[type].get(id)?.data as unknown as EntityMap[K] | undefined;
}

/** Create or update an entity. Pass the full entity when creating. */
export function save<K extends EntityType>(type: K, id: string, fields: Partial<EntityMap[K]>): void {
  const change = makeChange(type, id, fields as object, clock.tick()) as SyncRecord;
  const map = records[type];
  const { record } = mergeRecord(map.get(id), change);
  map.set(id, record);
  outbox.push(change);
  persist(record, change);
  emit();
  scheduleSync();
}

// Record and outbox entry are written in one transaction so a reload can never keep
// one without the other. `pendingWrites` lets sync (and tests) wait for them to land.
let pendingWrites: Promise<unknown> = Promise.resolve();

function persist(record: SyncRecord, change: SyncRecord) {
  if (!idb) return;
  const tx = idb.transaction(["records", "outbox"], "readwrite");
  void tx.objectStore("records").put(record, `${record.type}:${record.id}`);
  void tx.objectStore("outbox").add(change);
  const done = tx.done.catch((e) => console.error("could not save locally", e));
  pendingWrites = Promise.all([pendingWrites, done]);
}

/** Resolves once every local edit so far is stored in IndexedDB. */
export function flushWrites(): Promise<void> {
  return pendingWrites.then(() => undefined);
}

if (typeof window !== "undefined") (window as unknown as { gsdFlush: typeof flushWrites }).gsdFlush = flushWrites;

/** Apply several edits as one user action. */
export function saveMany(edits: { type: EntityType; id: string; fields: object }[]): void {
  for (const e of edits) save(e.type, e.id, e.fields as never);
}

// --- Server -----------------------------------------------------------------

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(meta.token ? { authorization: `Bearer ${meta.token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) {
    meta = { ...meta, token: null };
    await idb?.put("meta", meta, "meta");
    syncState = "signed-out";
    emit();
    throw new Error("Signed out");
  }
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `HTTP ${res.status}`);
  return (await res.json()) as T;
}

export { api as request };

export async function login(password: string): Promise<void> {
  const device = navigator.userAgent.includes("Android")
    ? "Android"
    : navigator.userAgent.includes("Mac")
      ? "Mac"
      : "Browser";
  const { token } = await api<{ token: string }>("/api/login", {
    method: "POST",
    body: JSON.stringify({ password, device }),
  });
  meta = { ...meta, token };
  await idb?.put("meta", meta, "meta");
  syncState = "idle";
  emit();
  await sync();
}

export async function logout(): Promise<void> {
  await api("/api/logout", { method: "POST" }).catch(() => undefined);
  meta = { ...meta, token: null };
  await idb?.put("meta", meta, "meta");
  syncState = "signed-out";
  emit();
}

let syncTimer: ReturnType<typeof setTimeout> | null = null;
let syncing: Promise<void> | null = null;

function scheduleSync(delay = 400) {
  if (syncTimer) clearTimeout(syncTimer);
  syncTimer = setTimeout(() => void sync(), delay);
}

export function sync(): Promise<void> {
  if (!meta.token) return Promise.resolve();
  if (syncing) return syncing.then(() => sync());
  syncing = doSync().finally(() => {
    syncing = null;
  });
  return syncing;
}

async function doSync(): Promise<void> {
  await flushWrites();
  syncState = "syncing";
  emit();
  try {
    if (outbox.length) {
      const sending = outbox.slice();
      await api("/api/sync", { method: "POST", body: JSON.stringify({ changes: sending }) });
      outbox = outbox.slice(sending.length);
      const tx = idb!.transaction("outbox", "readwrite");
      const keys = await tx.store.getAllKeys();
      for (const k of keys.slice(0, sending.length)) await tx.store.delete(k);
      await tx.done;
    }
    let more = true;
    while (more) {
      const page = await api<{ records: SyncRecord[]; cursor: number; more: boolean }>(`/api/sync?since=${meta.cursor}`);
      const tx = idb!.transaction("records", "readwrite");
      for (const incoming of page.records) {
        const map = records[incoming.type];
        const { record, changed } = mergeRecord(map.get(incoming.id), incoming);
        for (const c of Object.values(incoming.clocks)) clock.observe(c);
        if (changed) {
          map.set(incoming.id, record);
          void tx.store.put(record, `${incoming.type}:${incoming.id}`);
        }
      }
      await tx.done;
      meta = { ...meta, cursor: page.cursor };
      await idb!.put("meta", meta, "meta");
      more = page.more;
    }
    syncState = "idle";
  } catch (e) {
    if ((syncState as SyncState) !== "signed-out") syncState = navigator.onLine ? "error" : "offline";
    console.warn("sync failed", e);
  }
  emit();
}

export function pendingChanges(): number {
  return outbox.length;
}

/** Periodic sync and sync on focus/online. */
export function startBackgroundSync(): () => void {
  const t = setInterval(() => void sync(), 30_000);
  const onFocus = () => void sync();
  window.addEventListener("focus", onFocus);
  window.addEventListener("online", onFocus);
  void sync();
  return () => {
    clearInterval(t);
    window.removeEventListener("focus", onFocus);
    window.removeEventListener("online", onFocus);
  };
}
