import * as chrono from "chrono-node";
import type { Priority, Repeat } from "./types.js";
import { startOfDay } from "./dates.js";

export interface QuickAddResult {
  title: string;
  priority: Priority;
  tags: string[];
  /** Name typed after ~ or ^, resolved against known lists when provided. */
  listName: string | null;
  listId: string | null;
  dueDate: string | null;
  allDay: boolean;
  repeat: Repeat | null;
}

export interface QuickAddOptions {
  now?: Date;
  lists?: { id: string; name: string }[];
}

const PRIORITY_TOKENS: Record<string, Priority> = {
  "!high": 5, "!h": 5, "!3": 5,
  "!medium": 3, "!med": 3, "!m": 3, "!2": 3,
  "!low": 1, "!l": 1, "!1": 1,
  "!none": 0, "!0": 0,
};

const DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const RRULE_DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const DAY_ALIASES: Record<string, number> = {};
DAYS.forEach((d, i) => {
  DAY_ALIASES[d] = i;
  DAY_ALIASES[d.slice(0, 3)] = i;
});
DAY_ALIASES["tues"] = 2;
DAY_ALIASES["thur"] = 4;
DAY_ALIASES["thurs"] = 4;

interface RepeatMatch {
  repeat: Repeat;
  /** Weekdays named in the rule, used to choose a first due date. */
  days: number[];
}

function parseRepeat(text: string): { rest: string; match: RepeatMatch | null } {
  const unitFreq: Record<string, string> = {
    day: "DAILY", days: "DAILY", week: "WEEKLY", weeks: "WEEKLY",
    month: "MONTHLY", months: "MONTHLY", year: "YEARLY", years: "YEARLY",
  };
  const patterns: [RegExp, (m: RegExpMatchArray) => RepeatMatch | null][] = [
    [/\b(?:every\s*day|daily)\b/i, () => ({ repeat: { rrule: "FREQ=DAILY" }, days: [] })],
    [/\bevery\s+weekday\b/i, () => ({ repeat: { rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" }, days: [1, 2, 3, 4, 5] })],
    [/\bevery\s+weekend\b/i, () => ({ repeat: { rrule: "FREQ=WEEKLY;BYDAY=SA,SU" }, days: [6, 0] })],
    [/\b(?:every\s+week|weekly)\b/i, () => ({ repeat: { rrule: "FREQ=WEEKLY" }, days: [] })],
    [/\b(?:every\s+month|monthly)\b/i, () => ({ repeat: { rrule: "FREQ=MONTHLY" }, days: [] })],
    [/\b(?:every\s+year|yearly|annually)\b/i, () => ({ repeat: { rrule: "FREQ=YEARLY" }, days: [] })],
    [
      /\bevery\s+(\d+)\s+(days?|weeks?|months?|years?)(\s+after\s+(?:done|completion))?\b/i,
      (m) => {
        const n = Number(m[1]);
        const freq = unitFreq[m[2]!.toLowerCase()]!;
        return { repeat: { rrule: `FREQ=${freq};INTERVAL=${n}`, fromCompletion: !!m[3] }, days: [] };
      },
    ],
    [
      /\bevery\s+((?:(?:monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat|sunday|sun)\b(?:\s*,\s*|\s+and\s+|\s*&\s*)?)+)/i,
      (m) => {
        const days = m[1]!
          .toLowerCase()
          .split(/\s*,\s*|\s+and\s+|\s*&\s*|\s+/)
          .filter(Boolean)
          .map((d) => DAY_ALIASES[d])
          .filter((d): d is number => d !== undefined);
        if (!days.length) return null;
        const unique = [...new Set(days)];
        return {
          repeat: { rrule: `FREQ=WEEKLY;BYDAY=${unique.map((d) => RRULE_DAYS[d]).join(",")}` },
          days: unique,
        };
      },
    ],
  ];
  for (const [re, build] of patterns) {
    const m = text.match(re);
    if (m) {
      const match = build(m);
      if (match) return { rest: text.replace(m[0], " "), match };
    }
  }
  return { rest: text, match: null };
}

function nextWeekday(from: Date, days: number[]): Date {
  const base = startOfDay(from);
  for (let i = 0; i < 7; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() + i);
    if (days.includes(d.getDay())) return d;
  }
  return base;
}

/**
 * Parse a TickTick-style quick-add line, e.g.
 * "Call mum tomorrow 5pm !high #family ~Personal every week".
 */
export function parseQuickAdd(input: string, opts: QuickAddOptions = {}): QuickAddResult {
  const now = opts.now ?? new Date();
  let text = ` ${input} `;

  // Priority
  let priority: Priority = 0;
  text = text.replace(/(^|\s)(![a-z0-9]+)(?=\s)/gi, (whole, pre: string, tok: string) => {
    const p = PRIORITY_TOKENS[tok.toLowerCase()];
    if (p === undefined) return whole;
    priority = p;
    return pre;
  });

  // Tags
  const tags: string[] = [];
  text = text.replace(/(^|\s)#([\p{L}\p{N}_\-/]+)(?=\s)/gu, (_w, pre: string, tag: string) => {
    if (!tags.includes(tag)) tags.push(tag);
    return pre;
  });

  // List (~Name or ^Name; quotes allow spaces)
  let listName: string | null = null;
  text = text.replace(/(^|\s)[~^](?:"([^"]+)"|([\p{L}\p{N}_\-]+))(?=\s)/u, (_w, pre: string, q?: string, w?: string) => {
    listName = (q ?? w ?? "").trim();
    return pre;
  });
  let listId: string | null = null;
  if (listName && opts.lists) {
    const wanted = (listName as string).toLowerCase().replace(/[-_]/g, " ");
    const hit =
      opts.lists.find((l) => l.name.toLowerCase() === wanted) ??
      opts.lists.find((l) => l.name.toLowerCase().startsWith(wanted));
    if (hit) {
      listId = hit.id;
      listName = hit.name;
    }
  }

  // Repeat
  const rep = parseRepeat(text);
  text = rep.rest;

  // Date and time
  let dueDate: Date | null = null;
  let allDay = true;
  const results = chrono.parse(text, now, { forwardDate: true });
  const first = results[0];
  if (first) {
    dueDate = first.start.date();
    allDay = !first.start.isCertain("hour");
    if (allDay) dueDate = startOfDay(dueDate);
    text = text.slice(0, first.index) + " " + text.slice(first.index + first.text.length);
    // Drop a dangling "at"/"on"/"by" left before the date.
    text = text.replace(/\s(?:at|on|by|due)\s*$/i, " ");
  }

  if (rep.match && !dueDate) {
    dueDate = rep.match.days.length ? nextWeekday(now, rep.match.days) : startOfDay(now);
    allDay = true;
  }

  const title = text.replace(/\s+/g, " ").trim();
  return {
    title,
    priority,
    tags,
    listName,
    listId,
    dueDate: dueDate ? dueDate.toISOString() : null,
    allDay,
    repeat: rep.match?.repeat ?? null,
  };
}
