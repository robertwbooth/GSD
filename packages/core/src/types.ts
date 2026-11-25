/** Priority levels, matching TickTick's four levels. */
export type Priority = 0 | 1 | 3 | 5; // none, low, medium, high (TickTick's numeric values)

export const PRIORITY_LABEL: Record<Priority, string> = {
  0: "None",
  1: "Low",
  3: "Medium",
  5: "High",
};

export type TaskStatus = "open" | "completed" | "wontdo";

export type ViewMode = "list" | "board";

export interface ChecklistItem {
  id: string;
  title: string;
  done: boolean;
}

export interface Repeat {
  /** RFC 5545 RRULE body without DTSTART, e.g. "FREQ=WEEKLY;BYDAY=MO". */
  rrule: string;
  /** When true the next date is counted from the completion date, not the due date. */
  fromCompletion?: boolean;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  listId: string;
  parentId: string | null;
  sectionId: string | null;
  tags: string[];
  priority: Priority;
  /** ISO date-time. For all-day items this is local midnight. */
  startDate: string | null;
  dueDate: string | null;
  allDay: boolean;
  repeat: Repeat | null;
  /** Minutes before the due date/time, e.g. [0, 15]. */
  reminders: number[];
  checklist: ChecklistItem[];
  status: TaskStatus;
  completedAt: string | null;
  estimateMinutes: number | null;
  sortOrder: number;
  createdAt: string;
  deleted: boolean;
  /** Original id when imported from another app, used to make re-imports idempotent. */
  sourceId: string | null;
}

export interface TaskList {
  id: string;
  name: string;
  color: string | null;
  folderId: string | null;
  viewMode: ViewMode;
  sortOrder: number;
  deleted: boolean;
  sourceId: string | null;
}

export interface Section {
  id: string;
  listId: string;
  name: string;
  sortOrder: number;
  deleted: boolean;
}

export interface Folder {
  id: string;
  name: string;
  sortOrder: number;
  deleted: boolean;
}

export interface Filter {
  id: string;
  name: string;
  rule: FilterRule;
  sortOrder: number;
  deleted: boolean;
}

/** A saved smart-list rule. Empty arrays mean "any". */
export interface FilterRule {
  listIds: string[];
  tags: string[];
  priorities: Priority[];
  /** Date window relative to today. */
  due: "any" | "overdue" | "today" | "tomorrow" | "next7" | "nodate";
  keyword: string;
  match: "all" | "any";
}

export type EntityType = "task" | "list" | "section" | "folder" | "filter";

export interface EntityMap {
  task: Task;
  list: TaskList;
  section: Section;
  folder: Folder;
  filter: Filter;
}

export const INBOX_ID = "inbox";
