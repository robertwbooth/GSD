import { INBOX_ID, type ChecklistItem, type Priority, type Task } from "../types.js";
import { calendarDay, normaliseZone, parseInstant, parseReminder } from "./ticktick.js";

/**
 * Mapping between TickTick's Open API (https://developer.ticktick.com) and GSD tasks.
 * Ids match the backup importer (tt-<taskId>), so a synced task and an imported one are the same record.
 */

export interface TickTickApiItem {
  id: string;
  title?: string;
  status?: number;
  sortOrder?: number;
}

export interface TickTickApiTask {
  id: string;
  projectId: string;
  title?: string;
  content?: string;
  desc?: string;
  isAllDay?: boolean;
  startDate?: string;
  dueDate?: string;
  timeZone?: string;
  reminders?: string[];
  repeatFlag?: string;
  priority?: number;
  status?: number;
  sortOrder?: number;
  items?: TickTickApiItem[];
  /** Not in the published docs, but sent by the API; used when present. */
  tags?: string[];
  parentId?: string;
  kind?: string;
}

export interface TickTickApiProject {
  id: string;
  name: string;
  closed?: boolean;
  kind?: string;
  groupId?: string;
}

/** The fields GSD takes from TickTick. Everything else (section, estimate, history) stays GSD's. */
export const SYNCED_FIELDS = [
  "title", "description", "listId", "priority", "startDate", "dueDate", "allDay", "repeat", "reminders", "checklist",
] as const satisfies readonly (keyof Task)[];
export type SyncedFields = Pick<Task, (typeof SYNCED_FIELDS)[number]> & { tags?: string[]; parentId?: string | null };

export const taskIdFor = (ttId: string) => `tt-${ttId}`;
export const isInboxProject = (projectId: string) => projectId === "inbox" || projectId.startsWith("inbox");

export function apiTaskFields(
  t: TickTickApiTask,
  opts: { listId: string; displayZone: string },
): SyncedFields {
  const id = taskIdFor(t.id);
  const zone = normaliseZone(t.timeZone ?? "", opts.displayZone);
  const allDay = !!t.isAllDay;
  const due = parseInstant(t.dueDate ?? "");
  const start = parseInstant(t.startDate ?? "");
  const stored = (d: Date | null) => (d ? (allDay ? calendarDay(d, zone, opts.displayZone) : d).toISOString() : null);
  const dueDate = stored(due ?? start);
  const startDate = start && due && start.getTime() !== due.getTime() ? stored(start) : null;

  const reminders: number[] = [];
  for (const r of t.reminders ?? []) {
    const m = parseReminder(r.replace(/^TRIGGER:/i, ""));
    if (m !== null && !reminders.includes(m)) reminders.push(m);
  }

  const rule = (t.repeatFlag ?? "").replace(/^RRULE:/i, "").trim();
  const items = [...(t.items ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const checklist: ChecklistItem[] = items
    .filter((i) => (i.title ?? "").trim())
    .map((i, n) => ({ id: `${id}-${n}`, title: i.title!.trim(), done: i.status === 1 || i.status === 2 }));

  const priority = [0, 1, 3, 5].includes(t.priority ?? 0) ? ((t.priority ?? 0) as Priority) : 0;
  const fields: SyncedFields = {
    title: (t.title ?? "").trim(),
    description: ((t.content ?? "") || (t.desc ?? "")).replace(/\r\n?/g, "\n"),
    listId: isInboxProject(t.projectId) ? INBOX_ID : opts.listId,
    priority,
    startDate,
    dueDate,
    allDay: dueDate ? allDay : true,
    repeat: rule.startsWith("FREQ=") ? { rrule: rule } : null,
    reminders: dueDate ? reminders : [],
    checklist,
  };
  if (Array.isArray(t.tags)) fields.tags = t.tags.map((g) => g.trim().replace(/^#/, "").replace(/\s+/g, "-")).filter(Boolean);
  if (t.parentId !== undefined) fields.parentId = t.parentId ? taskIdFor(t.parentId) : null;
  return fields;
}

/** Deep equality for the plain JSON values in SyncedFields. */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Which fields to write to GSD. A field is written when TickTick changed it since the last sync
 * (so an edit made only in GSD is kept), or on first sight when it differs from GSD.
 */
export function fieldsToWrite(next: SyncedFields, previous: SyncedFields | null, current: Partial<Task> | null): Partial<Task> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(next)) {
    const cur = current ? (current as Record<string, unknown>)[k] : undefined;
    if (sameValue(v, cur)) continue;
    if (previous && sameValue(v, (previous as Record<string, unknown>)[k])) continue;
    out[k] = v;
  }
  return out as Partial<Task>;
}
