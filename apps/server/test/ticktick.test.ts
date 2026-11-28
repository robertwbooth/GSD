import { afterEach, describe, expect, it } from "vitest";
import { createTask, HybridClock, makeChange, type Task } from "@gsd/core";
import { buildApp } from "../src/app.js";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;
afterEach(async () => app?.close());

/** A pretend TickTick: projects and open tasks, recording completions. */
function fakeTickTick() {
  const state = {
    projects: [{ id: "p1", name: "Work" }, { id: "p2", name: "Garden" }, { id: "n1", name: "Notes", kind: "NOTE" }],
    tasks: {
      p1: [
        { id: "a", projectId: "p1", title: "Write report v2", priority: 5 },
        { id: "c", projectId: "p1", title: "Call Sam" },
      ],
      p2: [{ id: "d", projectId: "p2", title: "Plant bulbs", isAllDay: true, dueDate: "2026-12-01T08:00:00+0000", timeZone: "America/Vancouver" }],
      inbox: [{ id: "e", projectId: "inbox42", title: "Buy milk" }],
    } as Record<string, Record<string, unknown>[]>,
    completed: [] as string[],
    tokenRequests: 0,
  };
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url === "https://ticktick.com/oauth/token") {
      state.tokenRequests++;
      expect(String(init?.body)).toContain("code=the-code");
      return json({ access_token: "tok", expires_in: 15552000 });
    }
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const path = url.replace("https://api.ticktick.com/open/v1", "");
    if (path === "/project") return json(state.projects);
    const data = path.match(/^\/project\/([^/]+)\/data$/);
    if (data) return json({ tasks: state.tasks[data[1]!] ?? [] });
    const done = path.match(/^\/project\/([^/]+)\/task\/([^/]+)\/complete$/);
    if (done && init?.method === "POST") {
      state.completed.push(done[2]!);
      state.tasks[done[1]!] = (state.tasks[done[1]!] ?? []).filter((t) => t.id !== done[2]);
      return new Response("", { status: 200 });
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
  return { state, fetchImpl };
}

describe("TickTick live sync", () => {
  it("connects, pulls changes, completes vanished tasks and pushes ticks", async () => {
    const tt = fakeTickTick();
    app = await buildApp({
      dbPath: ":memory:", password: "secret", fetchImpl: tt.fetchImpl,
      ticktick: { clientId: "id", clientSecret: "shh", publicUrl: "https://gsd.example.ts.net" },
    });
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "secret" } });
    const headers = { authorization: `Bearer ${login.json().token}` };

    // Tasks imported earlier from a backup: a list named Work, and three of its tasks.
    const device = new HybridClock("browser", () => 1000);
    const imported = (id: string, title: string): Task => ({ ...createTask({ title, listId: "ttl-work" }), id: `tt-${id}`, sourceId: `ticktick:${id}` });
    await app.inject({
      method: "POST", url: "/api/sync", headers,
      payload: {
        changes: [
          makeChange("list", "ttl-work", { id: "ttl-work", name: "Work", color: null, folderId: null, viewMode: "list", sortOrder: 0, deleted: false, sourceId: null }, device.tick()),
          ...[imported("a", "Write report"), imported("b", "Old errand"), imported("c", "Call Sam")].map((t) => makeChange("task", t.id, t, device.tick())),
        ],
      },
    });

    expect((await app.inject({ method: "GET", url: "/api/ticktick", headers })).json()).toMatchObject({
      configured: true, connected: false, redirectUrl: "https://gsd.example.ts.net/api/ticktick/callback",
    });
    const { url } = (await app.inject({ method: "POST", url: "/api/ticktick/connect", headers, payload: { zone: "America/Vancouver" } })).json();
    const state = new URL(url).searchParams.get("state")!;
    expect(new URL(url).searchParams.get("redirect_uri")).toBe("https://gsd.example.ts.net/api/ticktick/callback");

    // A forged callback is refused; the real one connects.
    await app.inject({ method: "GET", url: "/api/ticktick/callback?code=the-code&state=wrong" });
    expect(tt.state.tokenRequests).toBe(0);
    const { url: url2 } = (await app.inject({ method: "POST", url: "/api/ticktick/connect", headers, payload: { zone: "America/Vancouver" } })).json();
    const cb = await app.inject({ method: "GET", url: `/api/ticktick/callback?code=the-code&state=${new URL(url2).searchParams.get("state")}` });
    expect(cb.statusCode).toBe(302);
    expect(state).not.toBe(new URL(url2).searchParams.get("state"));

    // Connecting starts the first sync straight away.
    let status = (await app.inject({ method: "GET", url: "/api/ticktick", headers })).json();
    for (let i = 0; i < 50 && !status.lastSync; i++) {
      await new Promise((res) => setTimeout(res, 20));
      status = (await app.inject({ method: "GET", url: "/api/ticktick", headers })).json();
    }
    expect(status).toMatchObject({ connected: true, lastError: null });
    expect(status.lastResult).toMatchObject({ lists: 2, created: 2, updated: 1, completedHere: 1, completedThere: 0 });

    const pull = async () => {
      const recs = (await app.inject({ method: "GET", url: "/api/sync?since=0", headers })).json().records as { type: string; id: string; data: Record<string, unknown> }[];
      return new Map(recs.map((x) => [`${x.type}:${x.id}`, x.data]));
    };
    let data = await pull();
    expect(data.get("task:tt-a")).toMatchObject({ title: "Write report v2", priority: 5, listId: "ttl-work" });
    expect(data.get("task:tt-b")).toMatchObject({ status: "completed" });
    expect(data.get("task:tt-d")).toMatchObject({ title: "Plant bulbs", listId: "ttp-p2", sourceId: "ticktick:d", allDay: true });
    expect(data.get("task:tt-e")).toMatchObject({ listId: "inbox" });
    expect(data.get("list:ttp-p2")).toMatchObject({ name: "Garden" });
    expect(data.has("list:ttp-n1")).toBe(false);

    // Rename a in GSD and tick c: the rename stays, and c is completed in TickTick.
    const later = new HybridClock("browser", () => Date.now() + 1000);
    await app.inject({
      method: "POST", url: "/api/sync", headers,
      payload: {
        changes: [
          makeChange("task", "tt-a", { title: "Report (mine)" }, later.tick()),
          makeChange("task", "tt-c", { status: "completed", completedAt: new Date(Date.now() + 1000).toISOString() }, later.tick()),
        ],
      },
    });
    const r2 = (await app.inject({ method: "POST", url: "/api/ticktick/sync", headers })).json();
    expect(r2).toMatchObject({ created: 0, updated: 0, completedThere: 1 });
    expect(tt.state.completed).toEqual(["c"]);
    data = await pull();
    expect(data.get("task:tt-a")).toMatchObject({ title: "Report (mine)" });

    // A third run changes nothing.
    expect((await app.inject({ method: "POST", url: "/api/ticktick/sync", headers })).json()).toMatchObject({ created: 0, updated: 0, completedHere: 0, completedThere: 0 });
  });

  it("is off without a TickTick app", async () => {
    app = await buildApp({ dbPath: ":memory:", password: "secret" });
    const login = await app.inject({ method: "POST", url: "/api/login", payload: { password: "secret" } });
    const headers = { authorization: `Bearer ${login.json().token}` };
    expect((await app.inject({ method: "GET", url: "/api/ticktick", headers })).json()).toMatchObject({ configured: false, connected: false });
    expect((await app.inject({ method: "POST", url: "/api/ticktick/connect", headers, payload: {} })).statusCode).toBe(400);
  });
});
