import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { importTickTick, isTickTickBackup, parseReminder, splitChecklist } from "../src/import/ticktick.js";
import { parseCsv } from "../src/import/csv.js";
import { INBOX_ID } from "../src/types.js";

const csv = readFileSync(new URL("./fixtures/ticktick-sample.csv", import.meta.url), "utf8");
const r = importTickTick(csv, { timeZone: "America/Vancouver" });
const byTitle = (t: string) => r.tasks.find((x) => x.title === t)!;

describe("parseCsv", () => {
  it("handles quotes, escaped quotes and newlines", () => {
    expect(parseCsv('a,"b ""c""","d\ne"\n1,2,3')).toEqual([["a", 'b "c"', "d\ne"], ["1", "2", "3"]]);
  });
});

describe("parseReminder", () => {
  it("converts TickTick triggers to minutes before", () => {
    expect(parseReminder("-PT60M")).toBe(60);
    expect(parseReminder("-PT1H")).toBe(60);
    expect(parseReminder("PT0S")).toBe(0);
    expect(parseReminder("-PT0S")).toBe(0);
    expect(parseReminder("P0DT9H0M0S")).toBe(-540);
    expect(parseReminder("-P1DT15H0M0S")).toBe(2340);
    expect(parseReminder("nonsense")).toBeNull();
  });
});

describe("splitChecklist", () => {
  it("separates items from text and skips empty items", () => {
    const s = splitChecklist("Intro\n▫One\n▪Two\n▫\n", "x");
    expect(s.description).toBe("Intro");
    expect(s.items.map((i) => [i.title, i.done])).toEqual([["One", false], ["Two", true]]);
  });
  it("accepts old Mac line endings", () => {
    expect(splitChecklist("▫One\r▪Two\r", "x").items).toHaveLength(2);
  });
});

describe("importTickTick", () => {
  it("detects backups", () => {
    expect(isTickTickBackup(csv)).toBe(true);
    expect(() => importTickTick("a,b\n1,2")).toThrow(/TickTick backup/);
  });

  it("creates folders, lists and kanban sections", () => {
    expect(r.folders.map((f) => f.name)).toEqual(["💚Personal", "🎤Work"]);
    const projects = r.lists.find((l) => l.name === "Projects")!;
    expect(projects.viewMode).toBe("board");
    expect(r.lists.find((l) => l.name === "🚴Cycling")!.folderId).toBe(r.folders.find((f) => f.name === "💚Personal")!.id);
    expect(r.lists.some((l) => l.name === "Inbox")).toBe(false);
    expect(r.sections).toEqual([expect.objectContaining({ name: "Admin", listId: projects.id })]);
    expect(byTitle("Launch").sectionId).toBe(r.sections[0]!.id);
    expect(byTitle("Old task").sectionId).toBeNull();
  });

  it("maps the Inbox, tags and priority", () => {
    expect(byTitle("Buy milk")).toMatchObject({ listId: INBOX_ID, tags: ["errands"], priority: 0, dueDate: null });
    expect(byTitle("Service bike")).toMatchObject({ tags: ["bike", "maintenance"], priority: 5 });
  });

  it("turns all-day dates into local midnight in the task's zone", () => {
    const d = new Date(byTitle("Service bike").dueDate!);
    expect(byTitle("Service bike").allDay).toBe(true);
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()]).toEqual([2026, 10, 27, 0]);
    const ride = new Date(byTitle("Weekly ride").dueDate!); // GMT-07:00 zone
    expect([ride.getDate(), ride.getHours()]).toEqual([29, 0]);
  });

  it("keeps timed dates as exact instants", () => {
    expect(byTitle("Order parts")).toMatchObject({ allDay: false, dueDate: "2026-11-26T17:30:00.000Z" });
  });

  it("reads checklists, reminders, repeats and status", () => {
    const bike = byTitle("Service bike");
    expect(bike.description).toBe("Before the ride");
    expect(bike.checklist.map((c) => c.done)).toEqual([false, true]);
    expect(bike.reminders).toEqual([-540]);
    expect(byTitle("Order parts")).toMatchObject({ status: "completed", completedAt: "2026-11-22T12:00:00.000Z", reminders: [60, 0], description: 'Brake pads, "the good ones"' });
    expect(byTitle("Weekly ride").repeat).toEqual({ rrule: "FREQ=WEEKLY;INTERVAL=1;BYDAY=SU" });
    expect(byTitle("Launch")).toMatchObject({ status: "wontdo", repeat: null });
  });

  it("links subtasks and detaches orphans", () => {
    expect(byTitle("Order parts").parentId).toBe(byTitle("Service bike").id);
    expect(byTitle("Old task").parentId).toBeNull();
  });

  it("keeps notes apart and uses stable ids", () => {
    expect(r.notes).toEqual([expect.objectContaining({ title: "Flying dream", listName: "😴Dreams", tags: ["dreams"] })]);
    expect(r.tasks.some((t) => t.title === "Flying dream")).toBe(false);
    expect(r.lists.some((l) => l.name === "😴Dreams")).toBe(false);
    const again = importTickTick(csv, { timeZone: "America/Vancouver" });
    expect(again.tasks.map((t) => t.id)).toEqual(r.tasks.map((t) => t.id));
    expect(again.lists.map((l) => l.id)).toEqual(r.lists.map((l) => l.id));
  });

  it("reports what it couldn't import", () => {
    expect(r.warnings.join(" ")).toMatch(/1 task\(s\) used TickTick's custom-dates repeat/);
    expect(r.warnings.join(" ")).toMatch(/1 subtask\(s\) had no parent/);
    expect(r.stats).toMatchObject({ open: 4, completed: 1, wontdo: 1, subtasks: 1, checklistItems: 2, repeating: 1 });
  });
});
