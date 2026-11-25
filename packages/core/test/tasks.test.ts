import { describe, expect, it } from "vitest";
import { completeTask, createTask, descendants } from "../src/tasks.js";
import { describeRepeat, nextOccurrence } from "../src/repeat.js";

const now = new Date(2026, 10, 25, 9, 0);

describe("repeat rules", () => {
  it("moves weekly tasks to the next matching weekday", () => {
    const due = new Date(2026, 10, 23, 0, 0); // Monday
    const next = nextOccurrence({ rrule: "FREQ=WEEKLY;BYDAY=MO,TH" }, due, now)!;
    expect([next.getMonth(), next.getDate()]).toEqual([10, 26]);
  });

  it("keeps local time across daylight saving changes", () => {
    const due = new Date(2026, 9, 31, 8, 0); // Sat 31 Oct, PDT
    const next = nextOccurrence({ rrule: "FREQ=DAILY;INTERVAL=2" }, due, due)!; // Mon 2 Nov, PST
    expect([next.getDate(), next.getHours()]).toEqual([2, 8]);
  });

  it("counts from completion when asked", () => {
    const due = new Date(2026, 10, 1, 10, 0);
    const next = nextOccurrence({ rrule: "FREQ=DAILY;INTERVAL=3", fromCompletion: true }, due, now)!;
    expect([next.getDate(), next.getHours()]).toEqual([28, 10]);
  });

  it("describes rules", () => {
    expect(describeRepeat({ rrule: "FREQ=WEEKLY;BYDAY=MO" })).toBe("Every week on Monday");
  });
});

describe("completeTask", () => {
  it("completes a plain task", () => {
    const t = createTask({ title: "x" }, now);
    const r = completeTask(t, now);
    expect(r.history).toBeNull();
    expect(r.update.status).toBe("completed");
  });

  it("advances a repeating task and records history", () => {
    const t = createTask(
      {
        title: "x",
        dueDate: new Date(2026, 10, 25).toISOString(),
        repeat: { rrule: "FREQ=DAILY" },
        checklist: [{ id: "c", title: "a", done: true }],
      },
      now,
    );
    const r = completeTask(t, now);
    expect(new Date(r.update.dueDate!).getDate()).toBe(26);
    expect(r.update.status).toBeUndefined();
    expect(r.update.checklist![0]!.done).toBe(false);
    expect(r.history).toMatchObject({ title: "x", status: "completed", repeat: null });
    expect(r.history!.id).not.toBe(t.id);
  });
});

describe("descendants", () => {
  it("finds nested subtasks", () => {
    const a = createTask({ title: "a" });
    const b = createTask({ title: "b", parentId: a.id });
    const c = createTask({ title: "c", parentId: b.id });
    const d = createTask({ title: "d" });
    expect(descendants([a, b, c, d], a.id).map((t) => t.title).sort()).toEqual(["b", "c"]);
  });
});
