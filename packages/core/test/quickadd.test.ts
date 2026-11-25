import { describe, expect, it } from "vitest";
import { parseQuickAdd } from "../src/quickadd.js";

// Wednesday 25 Nov 2026, 9:00 local time.
const now = new Date(2026, 10, 25, 9, 0);
const lists = [
  { id: "l1", name: "Personal" },
  { id: "l2", name: "Work Projects" },
];
const local = (iso: string | null) => (iso ? new Date(iso) : null);

describe("parseQuickAdd", () => {
  it("returns plain titles untouched", () => {
    const r = parseQuickAdd("Buy milk", { now });
    expect(r).toMatchObject({ title: "Buy milk", priority: 0, tags: [], dueDate: null, repeat: null });
  });

  it("parses priority, tags and list", () => {
    const r = parseQuickAdd("Call mum !high #family #calls ~Personal", { now, lists });
    expect(r.title).toBe("Call mum");
    expect(r.priority).toBe(5);
    expect(r.tags).toEqual(["family", "calls"]);
    expect(r.listId).toBe("l1");
  });

  it("matches list by prefix and quoted names", () => {
    expect(parseQuickAdd("Plan ~work", { now, lists }).listId).toBe("l2");
    expect(parseQuickAdd('Plan ~"work projects"', { now, lists }).listId).toBe("l2");
  });

  it("keeps an unknown list name without an id", () => {
    const r = parseQuickAdd("Plan ~Garden", { now, lists });
    expect(r.listName).toBe("Garden");
    expect(r.listId).toBeNull();
  });

  it("parses tomorrow with a time", () => {
    const r = parseQuickAdd("Dentist tomorrow at 5pm", { now });
    expect(r.title).toBe("Dentist");
    expect(r.allDay).toBe(false);
    const d = local(r.dueDate)!;
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([26, 17, 0]);
  });

  it("parses an all-day date", () => {
    const r = parseQuickAdd("Pay rent on Dec 1", { now });
    expect(r.title).toBe("Pay rent");
    expect(r.allDay).toBe(true);
    const d = local(r.dueDate)!;
    expect([d.getMonth(), d.getDate(), d.getHours()]).toEqual([11, 1, 0]);
  });

  it("parses weekday names as the next one", () => {
    const d = local(parseQuickAdd("Gym friday", { now }).dueDate)!;
    expect(d.getDay()).toBe(5);
    expect(d.getDate()).toBe(27);
  });

  it("parses repeats and sets a first date", () => {
    const r = parseQuickAdd("Water plants every monday and thursday", { now });
    expect(r.title).toBe("Water plants");
    expect(r.repeat).toEqual({ rrule: "FREQ=WEEKLY;BYDAY=MO,TH" });
    expect(local(r.dueDate)!.getDate()).toBe(26); // Thursday
  });

  it("parses interval repeats after completion", () => {
    const r = parseQuickAdd("Change filter every 3 months after done", { now });
    expect(r.title).toBe("Change filter");
    expect(r.repeat).toEqual({ rrule: "FREQ=MONTHLY;INTERVAL=3", fromCompletion: true });
  });

  it("combines repeat with an explicit time", () => {
    const r = parseQuickAdd("Standup daily 9:30am #work", { now });
    expect(r.title).toBe("Standup");
    expect(r.repeat?.rrule).toBe("FREQ=DAILY");
    const d = local(r.dueDate)!;
    expect([d.getHours(), d.getMinutes()]).toEqual([9, 30]);
  });

  it("ignores unknown ! tokens and email-like text", () => {
    const r = parseQuickAdd("Wow! email bob@example.com !nope", { now });
    expect(r.title).toBe("Wow! email bob@example.com !nope");
    expect(r.priority).toBe(0);
  });
});
