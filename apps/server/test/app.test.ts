import { afterEach, describe, expect, it } from "vitest";
import { HybridClock, makeChange } from "@gsd/core";
import { buildApp } from "../src/app.js";

type App = Awaited<ReturnType<typeof buildApp>>;
let app: App;

async function setup(extra: Partial<Parameters<typeof buildApp>[0]> = {}) {
  app = await buildApp({ dbPath: ":memory:", password: "secret", ...extra });
  const res = await app.inject({ method: "POST", url: "/api/login", payload: { password: "secret", device: "test" } });
  return { authorization: `Bearer ${res.json().token}` };
}
afterEach(async () => app?.close());

describe("auth", () => {
  it("rejects a wrong password and unauthenticated sync", async () => {
    await setup();
    expect((await app.inject({ method: "POST", url: "/api/login", payload: { password: "nope" } })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/sync" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/api/sync", headers: { authorization: "Bearer bad" } })).statusCode).toBe(401);
  });

  it("locks out after repeated failures", async () => {
    await setup();
    for (let i = 0; i < 10; i++) await app.inject({ method: "POST", url: "/api/login", payload: { password: "x" } });
    const r = await app.inject({ method: "POST", url: "/api/login", payload: { password: "secret" } });
    expect(r.statusCode).toBe(429);
  });

  it("logs out a device", async () => {
    const headers = await setup();
    expect((await app.inject({ method: "POST", url: "/api/logout", headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/sync", headers })).statusCode).toBe(401);
  });
});

describe("sync", () => {
  it("merges pushes per field and pages pulls by cursor", async () => {
    const headers = await setup();
    const a = new HybridClock("a", () => 1000);
    const b = new HybridClock("b", () => 2000);
    const create = makeChange("task", "t1", { title: "first", priority: 0 }, a.tick());
    let r = await app.inject({ method: "POST", url: "/api/sync", headers, payload: { changes: [create] } });
    expect(r.json().cursor).toBe(1);

    const editB = makeChange("task", "t1", { priority: 5 }, b.tick());
    const staleA = makeChange("task", "t1", { title: "renamed", priority: 1 }, HybridClock.format(1500, 0, "a"));
    await app.inject({ method: "POST", url: "/api/sync", headers, payload: { changes: [editB] } });
    await app.inject({ method: "POST", url: "/api/sync", headers, payload: { changes: [staleA] } });

    r = await app.inject({ method: "GET", url: "/api/sync?since=0", headers });
    const body = r.json();
    expect(body.records).toHaveLength(1);
    expect(body.records[0].data).toEqual({ title: "renamed", priority: 5 });
    expect(body.cursor).toBe(3);

    r = await app.inject({ method: "GET", url: `/api/sync?since=${body.cursor}`, headers });
    expect(r.json().records).toHaveLength(0);
  });

  it("rejects malformed changes", async () => {
    const headers = await setup();
    const r = await app.inject({ method: "POST", url: "/api/sync", headers, payload: { changes: [{ id: "x", type: "evil" }] } });
    expect(r.statusCode).toBe(400);
  });
});

describe("feedback", () => {
  it("saves feedback when GitHub is not configured", async () => {
    const headers = await setup();
    const r = await app.inject({ method: "POST", url: "/api/feedback", headers, payload: { kind: "idea", text: "Dark mode", context: { view: "Today" } } });
    expect(r.json()).toMatchObject({ kind: "idea", status: "saved", issueNumber: null });
  });

  it("files a GitHub issue with labels and context", async () => {
    const calls: { url: string; body: any; auth: string }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), auth: (init.headers as Record<string, string>).authorization! });
      return new Response(JSON.stringify({ number: 7, html_url: "https://github.com/o/r/issues/7" }), { status: 201 });
    }) as unknown as typeof fetch;
    const headers = await setup({ github: { token: "tok", repo: "o/r" }, fetchImpl });
    const r = await app.inject({
      method: "POST", url: "/api/feedback", headers,
      payload: { kind: "bug", text: "Quick add drops tags\nmore detail", context: { view: "Inbox", device: "Mac" } },
    });
    expect(r.json()).toMatchObject({ status: "filed", issueNumber: 7 });
    expect(calls[0]!.url).toBe("https://api.github.com/repos/o/r/issues");
    expect(calls[0]!.auth).toBe("Bearer tok");
    expect(calls[0]!.body.title).toBe("Quick add drops tags");
    expect(calls[0]!.body.labels).toEqual(["feedback", "bug"]);
    expect(calls[0]!.body.body).toContain("**view:** Inbox");
  });

  it("queues feedback when GitHub fails and retries later", async () => {
    let fail = true;
    const fetchImpl = (async () =>
      fail
        ? new Response("down", { status: 502 })
        : new Response(JSON.stringify({ number: 9, html_url: "u" }), { status: 201 })) as unknown as typeof fetch;
    const headers = await setup({ github: { token: "t", repo: "o/r" }, fetchImpl });
    const r = await app.inject({ method: "POST", url: "/api/feedback", headers, payload: { kind: "change", text: "x" } });
    expect(r.json().status).toBe("retrying");
    fail = false;
    await app.inject({ method: "GET", url: "/api/feedback", headers });
    await new Promise((res) => setTimeout(res, 20));
    const list = (await app.inject({ method: "GET", url: "/api/feedback", headers })).json();
    expect(list.items[0]).toMatchObject({ status: "filed", issueNumber: 9 });
  });
});
