import { INBOX_ID, type ChecklistItem, type Folder, type Priority, type Section, type Task, type TaskList, type TaskStatus } from "../types.js";
import { csvObjects } from "./csv.js";

/**
 * Convert a TickTick backup (Settings → Account → Generate Backup, CSV) into GSD entities.
 * Ids are derived from TickTick's ids so importing the same backup twice finds the same records.
 */

export interface TickTickNote {
  sourceId: string;
  title: string;
  content: string;
  /** TickTick list the note lived in, used as the parent page name. */
  listName: string;
  folderName: string;
  tags: string[];
  createdAt: string;
}

export interface TickTickImport {
  folders: Folder[];
  lists: TaskList[];
  sections: Section[];
  tasks: Task[];
  /** Notes are kept separately; they become pages once Notes exists. */
  notes: TickTickNote[];
  warnings: string[];
  stats: { open: number; completed: number; wontdo: number; subtasks: number; checklistItems: number; repeating: number };
}

export interface TickTickOptions {
  /** Time zone used for all-day dates when a row has none. Defaults to the runtime's zone. */
  timeZone?: string;
}

/** Stable short hash (FNV-1a, 32-bit) for building ids from names. */
export function stableHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const STATUS: Record<string, TaskStatus> = { "0": "open", "2": "completed", "1": "completed", "-1": "wontdo" };
const PRIORITIES = new Set([0, 1, 3, 5]);

function normaliseZone(tz: string, fallback: string): string {
  const t = tz.trim();
  if (!t) return fallback;
  const gmt = t.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (gmt) {
    if (gmt[3] && gmt[3] !== "00") return fallback;
    // Etc/GMT zones use the inverted sign.
    return `Etc/GMT${gmt[1] === "+" ? "-" : "+"}${Number(gmt[2])}`;
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: t });
    return t;
  } catch {
    return fallback;
  }
}

/** TickTick writes "2024-09-01T07:00:00+0000"; make it parseable everywhere. */
function parseInstant(s: string): Date | null {
  if (!s) return null;
  const iso = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

const dayFormatters = new Map<string, Intl.DateTimeFormat>();
/** The calendar day of `d` in `tz`, as local midnight in the runtime's zone. */
function calendarDay(d: Date, tz: string): Date {
  let f = dayFormatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    dayFormatters.set(tz, f);
  }
  const [y, m, day] = f.format(d).split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, day);
}

/**
 * TickTick reminder triggers are ISO 8601 durations relative to the due time:
 * "-PT60M" is an hour before, "P0DT9H0M0S" is 9 am on an all-day task's day.
 * GSD stores minutes before the due time, so 9 am on the day becomes -540.
 */
export function parseReminder(trigger: string): number | null {
  const m = trigger.trim().match(/^(-)?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);
  if (!m) return null;
  const [, neg, w, d, h, min, s] = m;
  const minutes = Number(w ?? 0) * 10080 + Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(min ?? 0) + Math.round(Number(s ?? 0) / 60);
  return neg ? minutes : minutes === 0 ? 0 : -minutes;
}

/** Split a CHECKLIST task's content into description text and checklist items. */
export function splitChecklist(content: string, idPrefix: string): { description: string; items: ChecklistItem[] } {
  const items: ChecklistItem[] = [];
  const text: string[] = [];
  content.split(/\r\n|\r|\n/).forEach((line) => {
    const mark = line[0];
    if (mark === "▫" || mark === "▪") {
      const title = line.slice(1).trim();
      if (title) items.push({ id: `${idPrefix}-${items.length}`, title, done: mark === "▪" });
    } else text.push(line);
  });
  return { description: text.join("\n").trim(), items };
}

function cleanTag(t: string): string {
  return t.trim().replace(/^#/, "").replace(/\s+/g, "-");
}

function toNumber(s: string, fallback: number): number {
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

export function isTickTickBackup(text: string): boolean {
  return /"Folder Name","List Name","Title"/.test(text.slice(0, 4000));
}

export function importTickTick(csvText: string, opts: TickTickOptions = {}): TickTickImport {
  const defaultZone = opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const rows = csvObjects(csvText, (r) => r[0] === "Folder Name" && r[1] === "List Name");
  if (!rows.length) throw new Error("This doesn't look like a TickTick backup file.");

  const warnings: string[] = [];
  const folders = new Map<string, Folder>();
  const lists = new Map<string, TaskList>();
  const sections = new Map<string, Section>();
  const tasks: Task[] = [];
  const notes: TickTickNote[] = [];
  const noteIds = new Set<string>();
  let customRepeats = 0;
  let badReminders = 0;

  const folderFor = (name: string): string | null => {
    if (!name) return null;
    const id = `ttf-${stableHash(name)}`;
    if (!folders.has(id)) folders.set(id, { id, name, sortOrder: folders.size, deleted: false });
    return id;
  };

  const listFor = (row: Record<string, string>): string => {
    const name = row["List Name"] ?? "";
    if (!name || name === "Inbox") return INBOX_ID;
    const folderName = row["Folder Name"] ?? "";
    const id = `ttl-${stableHash(`${folderName}\u0000${name}`)}`;
    const existing = lists.get(id);
    if (existing) {
      if (row["View Mode"] === "kanban") existing.viewMode = "board";
      return id;
    }
    lists.set(id, {
      id,
      name,
      color: null,
      folderId: folderFor(folderName),
      viewMode: row["View Mode"] === "kanban" ? "board" : "list",
      sortOrder: lists.size,
      deleted: false,
      sourceId: `ticktick-list:${folderName}/${name}`,
    });
    return id;
  };

  // Notes first, so subtasks of notes can be detached.
  for (const row of rows) {
    if (row["Kind"] === "NOTE" || row["projectKind"] === "NOTE") {
      noteIds.add(row["taskId"] ?? "");
      notes.push({
        sourceId: `ticktick:${row["taskId"]}`,
        title: (row["Title"] ?? "").trim() || "Untitled",
        content: (row["Content"] ?? "").replace(/\r\n?/g, "\n"),
        listName: row["List Name"] ?? "",
        folderName: row["Folder Name"] ?? "",
        tags: (row["Tags"] ?? "").split(",").map(cleanTag).filter(Boolean),
        createdAt: parseInstant(row["Created Time"] ?? "")?.toISOString() ?? new Date().toISOString(),
      });
    }
  }

  for (const row of rows) {
    const ttId = row["taskId"] ?? "";
    if (noteIds.has(ttId)) continue;
    const id = `tt-${ttId}`;
    const listId = listFor(row);
    const zone = normaliseZone(row["Timezone"] ?? "", defaultZone);
    const allDay = row["Is All Day"] === "true";

    const due = parseInstant(row["Due Date"] ?? "");
    const start = parseInstant(row["Start Date"] ?? "");
    const asStored = (d: Date | null) => (d ? (allDay ? calendarDay(d, zone) : d).toISOString() : null);
    const dueDate = asStored(due ?? start);
    const startDate = start && due && start.getTime() !== due.getTime() ? asStored(start) : null;

    let repeat: Task["repeat"] = null;
    const rule = (row["Repeat"] ?? "").replace(/^RRULE:/i, "").trim();
    if (rule.startsWith("FREQ=")) repeat = { rrule: rule };
    else if (rule) customRepeats++;

    const reminders: number[] = [];
    for (const r of (row["Reminder"] ?? "").split(/\r?\n|\r/).filter(Boolean)) {
      const m = parseReminder(r);
      if (m === null) badReminders++;
      else if (!reminders.includes(m)) reminders.push(m);
    }

    const content = (row["Content"] ?? "").replace(/\r\n?/g, "\n");
    let description = content;
    let checklist: ChecklistItem[] = [];
    if (row["Kind"] === "CHECKLIST" || row["Is Check list"] === "Y") {
      const split = splitChecklist(content, id);
      description = split.description;
      checklist = split.items;
    }

    let sectionId: string | null = null;
    const column = (row["Column Name"] ?? "").trim();
    if (column && column !== "Not Sectioned" && listId !== INBOX_ID) {
      sectionId = `tts-${stableHash(`${listId}\u0000${column}`)}`;
      if (!sections.has(sectionId)) {
        sections.set(sectionId, { id: sectionId, listId, name: column, sortOrder: toNumber(row["Column Order"] ?? "", sections.size), deleted: false });
      }
    }

    const status = STATUS[row["Status"] ?? "0"] ?? "open";
    const priority = toNumber(row["Priority"] ?? "0", 0);
    const parent = row["parentId"] ?? "";

    tasks.push({
      id,
      title: (row["Title"] ?? "").trim(),
      description,
      listId,
      parentId: parent && !noteIds.has(parent) ? `tt-${parent}` : null,
      sectionId,
      tags: (row["Tags"] ?? "").split(",").map(cleanTag).filter(Boolean),
      priority: (PRIORITIES.has(priority) ? priority : 0) as Priority,
      startDate,
      dueDate,
      allDay: dueDate ? allDay : true,
      repeat,
      reminders: dueDate ? reminders : [],
      checklist,
      status,
      completedAt: status === "open" ? null : (parseInstant(row["Completed Time"] ?? "") ?? parseInstant(row["Created Time"] ?? ""))?.toISOString() ?? null,
      estimateMinutes: null,
      sortOrder: toNumber(row["Order"] ?? "", tasks.length),
      createdAt: parseInstant(row["Created Time"] ?? "")?.toISOString() ?? new Date().toISOString(),
      deleted: false,
      sourceId: `ticktick:${ttId}`,
    });
  }

  // Subtasks whose parent is missing become top-level tasks.
  const ids = new Set(tasks.map((t) => t.id));
  let orphans = 0;
  for (const t of tasks) {
    if (t.parentId && !ids.has(t.parentId)) {
      t.parentId = null;
      orphans++;
    }
  }

  if (customRepeats) warnings.push(`${customRepeats} task(s) used TickTick's custom-dates repeat, which isn't supported yet. They were imported without a repeat.`);
  if (badReminders) warnings.push(`${badReminders} reminder(s) couldn't be read and were skipped.`);
  if (orphans) warnings.push(`${orphans} subtask(s) had no parent in the backup and were made top-level tasks.`);

  return {
    folders: [...folders.values()],
    lists: [...lists.values()],
    sections: [...sections.values()],
    tasks,
    notes,
    warnings,
    stats: {
      open: tasks.filter((t) => t.status === "open").length,
      completed: tasks.filter((t) => t.status === "completed").length,
      wontdo: tasks.filter((t) => t.status === "wontdo").length,
      subtasks: tasks.filter((t) => t.parentId).length,
      checklistItems: tasks.reduce((n, t) => n + t.checklist.length, 0),
      repeating: tasks.filter((t) => t.repeat).length,
    },
  };
}
