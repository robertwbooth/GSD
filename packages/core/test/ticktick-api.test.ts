import { describe, expect, it } from "vitest";
import { apiTaskFields, fieldsToWrite, midnightInZone } from "../src/index.js";

const zone = "America/Vancouver";

describe("TickTick API tasks", () => {
  it("maps fields like the backup importer", () => {
    const f = apiTaskFields(
      {
        id: "abc", projectId: "p1", title: " Pay rent ", content: "Line 1\r\nLine 2", isAllDay: true,
        dueDate: "2026-12-01T08:00:00+0000", startDate: "2026-12-01T08:00:00+0000", timeZone: zone,
        reminders: ["TRIGGER:P0DT9H0M0S", "TRIGGER:-PT30M"], repeatFlag: "RRULE:FREQ=MONTHLY;BYMONTHDAY=1", priority: 5,
        items: [{ id: "i2", title: "b", status: 1, sortOrder: 2 }, { id: "i1", title: "a", status: 0, sortOrder: 1 }],
        tags: ["home stuff"],
      },
      { listId: "L", displayZone: zone },
    );
    expect(f).toMatchObject({
      title: "Pay rent", description: "Line 1\nLine 2", listId: "L", priority: 5, allDay: true, startDate: null,
      repeat: { rrule: "FREQ=MONTHLY;BYMONTHDAY=1" }, reminders: [-540, 30], tags: ["home-stuff"],
      checklist: [{ id: "tt-abc-0", title: "a", done: false }, { id: "tt-abc-1", title: "b", done: true }],
    });
    // All-day dates are midnight in the display zone, whatever zone the server runs in.
    expect(f.dueDate).toBe(midnightInZone(2026, 12, 1, zone).toISOString());
    const local = new Intl.DateTimeFormat("en-CA", { timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit" }).format(new Date(f.dueDate!));
    expect(local).toBe("2026-12-01, 00");
  });

  it("puts Inbox tasks in the Inbox", () => {
    expect(apiTaskFields({ id: "x", projectId: "inbox123" }, { listId: "L", displayZone: zone }).listId).toBe("inbox");
  });

  it("finds midnight on both sides of a daylight-saving change", () => {
    expect(midnightInZone(2025, 7, 1, zone).toISOString()).toBe("2025-07-01T07:00:00.000Z");
    expect(midnightInZone(2025, 1, 15, zone).toISOString()).toBe("2025-01-15T08:00:00.000Z");
    expect(midnightInZone(2025, 3, 9, zone).toISOString()).toBe("2025-03-09T08:00:00.000Z");
  });

  it("keeps GSD-only edits unless TickTick changed that field", () => {
    const prev = apiTaskFields({ id: "x", projectId: "p", title: "Old", priority: 1 }, { listId: "L", displayZone: zone });
    const next = apiTaskFields({ id: "x", projectId: "p", title: "Old", priority: 3 }, { listId: "L", displayZone: zone });
    const current = { ...prev, title: "Renamed in GSD" };
    expect(fieldsToWrite(next, prev, current)).toEqual({ priority: 3 });
    // First sight: TickTick wins where it differs.
    expect(fieldsToWrite(next, null, current)).toEqual({ title: "Old", priority: 3 });
  });
});
