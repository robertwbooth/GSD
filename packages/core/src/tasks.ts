import { newId } from "./ids.js";
import { nextOccurrence } from "./repeat.js";
import { INBOX_ID, type Task, type TaskList } from "./types.js";

export function createTask(fields: Partial<Task> & { title: string }, now = new Date()): Task {
  return {
    id: newId(),
    description: "",
    listId: INBOX_ID,
    parentId: null,
    sectionId: null,
    tags: [],
    priority: 0,
    startDate: null,
    dueDate: null,
    allDay: true,
    repeat: null,
    reminders: [],
    checklist: [],
    status: "open",
    completedAt: null,
    estimateMinutes: null,
    sortOrder: now.getTime(),
    createdAt: now.toISOString(),
    deleted: false,
    sourceId: null,
    ...fields,
  };
}

export function createList(fields: Partial<TaskList> & { name: string }, now = new Date()): TaskList {
  return {
    id: newId(),
    color: null,
    folderId: null,
    viewMode: "list",
    sortOrder: now.getTime(),
    deleted: false,
    sourceId: null,
    ...fields,
  };
}

export interface CompleteResult {
  /** Changes to apply to the task itself. */
  update: Partial<Task>;
  /** For repeating tasks, a completed copy recording this occurrence. */
  history: Task | null;
}

/**
 * Complete a task. A repeating task moves to its next date and stays open, and a
 * completed copy is kept as history, as TickTick does.
 */
export function completeTask(task: Task, now = new Date()): CompleteResult {
  if (task.repeat && task.dueDate) {
    const next = nextOccurrence(task.repeat, new Date(task.dueDate), now);
    if (next) {
      const history: Task = {
        ...task,
        id: newId(),
        repeat: null,
        status: "completed",
        completedAt: now.toISOString(),
      };
      let startDate = task.startDate;
      if (startDate) {
        const shift = next.getTime() - new Date(task.dueDate).getTime();
        startDate = new Date(new Date(startDate).getTime() + shift).toISOString();
      }
      return {
        update: {
          dueDate: next.toISOString(),
          startDate,
          checklist: task.checklist.map((c) => ({ ...c, done: false })),
        },
        history,
      };
    }
  }
  return { update: { status: "completed", completedAt: now.toISOString() }, history: null };
}

export function reopenTask(): Partial<Task> {
  return { status: "open", completedAt: null };
}

/** Default ordering: dated tasks first by date, then priority (high first), then manual order. */
export function compareTasks(a: Task, b: Task): number {
  const ad = a.dueDate ? Date.parse(a.dueDate) : Infinity;
  const bd = b.dueDate ? Date.parse(b.dueDate) : Infinity;
  if (ad !== bd) return ad - bd;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return a.sortOrder - b.sortOrder;
}

/** All descendants of a task (subtasks at any depth). */
export function descendants(tasks: Task[], id: string): Task[] {
  const out: Task[] = [];
  const stack = [id];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const t of tasks) {
      if (t.parentId === cur && !t.deleted) {
        out.push(t);
        stack.push(t.id);
      }
    }
  }
  return out;
}
