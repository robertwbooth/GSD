import { describe, expect, it } from "vitest";
import { HybridClock, makeChange, mergeRecord } from "../src/sync.js";

describe("HybridClock", () => {
  it("is monotonic within one millisecond", () => {
    const c = new HybridClock("a", () => 1000);
    const x = c.tick();
    const y = c.tick();
    expect(y > x).toBe(true);
  });
  it("moves past observed clocks", () => {
    const c = new HybridClock("a", () => 1000);
    c.observe(HybridClock.format(5000, 3, "b"));
    expect(c.tick() > HybridClock.format(5000, 3, "b")).toBe(true);
  });
});

describe("mergeRecord", () => {
  it("keeps concurrent edits to different fields", () => {
    const base = makeChange("task", "t", { title: "a", priority: 0 }, HybridClock.format(1, 0, "x"));
    const fromA = makeChange("task", "t", { title: "b" }, HybridClock.format(2, 0, "a"));
    const fromB = makeChange("task", "t", { priority: 5 }, HybridClock.format(3, 0, "b"));
    let r = mergeRecord(base, fromA).record;
    r = mergeRecord(r, fromB).record;
    expect(r.data).toEqual({ title: "b", priority: 5 });
  });
  it("ignores older writes and is order independent", () => {
    const older = makeChange("task", "t", { title: "old" }, HybridClock.format(1, 0, "a"));
    const newer = makeChange("task", "t", { title: "new" }, HybridClock.format(2, 0, "b"));
    const ab = mergeRecord(mergeRecord(undefined, older).record, newer);
    const ba = mergeRecord(mergeRecord(undefined, newer).record, older);
    expect(ab.record.data.title).toBe("new");
    expect(ba.record.data.title).toBe("new");
    expect(ba.changed).toBe(false);
  });
});
