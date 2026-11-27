import {
  completeTask,
  createList,
  createTask,
  descendants,
  INBOX_ID,
  parseQuickAdd,
  reopenTask,
  type Task,
  type TaskList,
} from "@gsd/core";
import * as store from "./store";

/** One undoable user action: the fields to restore per task. */
interface UndoEntry {
  label: string;
  restore: { id: string; fields: Partial<Task> }[];
  remove: string[];
}

let lastUndo: UndoEntry | null = null;
const undoListeners = new Set<(e: UndoEntry | null) => void>();
function setUndo(e: UndoEntry | null) {
  lastUndo = e;
  for (const l of undoListeners) l(e);
}
export function onUndoChange(l: (e: UndoEntry | null) => void) {
  undoListeners.add(l);
  return () => undoListeners.delete(l);
}

function snapshot(task: Task, keys: (keyof Task)[]): Partial<Task> {
  const out: Partial<Task> = {};
  for (const k of keys) (out as Record<string, unknown>)[k] = task[k];
  return out;
}

export function undo() {
  const e = lastUndo;
  if (!e) return;
  for (const r of e.restore) store.save("task", r.id, r.fields);
  for (const id of e.remove) store.save("task", id, { deleted: true });
  setUndo(null);
}

export function allTasks(): Task[] {
  return store.all("task");
}
export function allLists(): TaskList[] {
  return store.all("list").filter((l) => !l.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
}

export interface QuickAddContext {
  listId?: string;
  dueToday?: boolean;
  dueTomorrow?: boolean;
  tag?: string;
  parentId?: string;
  sectionId?: string | null;
}

export function quickAdd(text: string, ctx: QuickAddContext = {}): Task | null {
  const lists = allLists();
  const r = parseQuickAdd(text, { lists });
  if (!r.title) return null;
  let listId = r.listId ?? ctx.listId ?? INBOX_ID;
  if (r.listName && !r.listId) {
    const list = createList({ name: r.listName });
    store.save("list", list.id, list);
    listId = list.id;
  }
  let dueDate = r.dueDate;
  if (!dueDate && (ctx.dueToday || ctx.dueTomorrow)) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (ctx.dueTomorrow) d.setDate(d.getDate() + 1);
    dueDate = d.toISOString();
  }
  const tags = [...r.tags];
  if (ctx.tag && !tags.includes(ctx.tag)) tags.push(ctx.tag);
  const task = createTask({
    title: r.title,
    listId,
    tags,
    priority: r.priority,
    dueDate,
    allDay: r.allDay,
    repeat: r.repeat,
    parentId: ctx.parentId ?? null,
    sectionId: ctx.sectionId ?? null,
  });
  store.save("task", task.id, task);
  return task;
}

export function addSubtask(parent: Task, title: string): Task | null {
  return quickAdd(title, { listId: parent.listId, parentId: parent.id });
}

export function toggleComplete(task: Task) {
  if (task.status !== "open") {
    store.save("task", task.id, reopenTask());
    setUndo({ label: "Task reopened", restore: [{ id: task.id, fields: snapshot(task, ["status", "completedAt"]) }], remove: [] });
    return;
  }
  const { update, history } = completeTask(task);
  const restore = [{ id: task.id, fields: snapshot(task, Object.keys(update) as (keyof Task)[]) }];
  store.save("task", task.id, update);
  if (history) store.save("task", history.id, history);
  setUndo({ label: history ? "Moved to next date" : "Completed", restore, remove: history ? [history.id] : [] });
}

export function setWontDo(task: Task) {
  const restore = [{ id: task.id, fields: snapshot(task, ["status", "completedAt"]) }];
  store.save("task", task.id, { status: "wontdo", completedAt: new Date().toISOString() });
  setUndo({ label: "Marked won't do", restore, remove: [] });
}

export function deleteTask(task: Task) {
  const all = [task, ...descendants(allTasks(), task.id)];
  for (const t of all) store.save("task", t.id, { deleted: true });
  setUndo({ label: all.length > 1 ? `Deleted ${all.length} tasks` : "Deleted", restore: all.map((t) => ({ id: t.id, fields: { deleted: false } })), remove: [] });
}

/** Change some fields of a task with an Undo, e.g. from the right-click menu. */
export function changeTask(task: Task, fields: Partial<Task>, label: string) {
  const restore = [{ id: task.id, fields: snapshot(task, Object.keys(fields) as (keyof Task)[]) }];
  store.save("task", task.id, fields);
  setUndo({ label, restore, remove: [] });
}

/** Set a task's date to a day, keeping its time if it has one. `null` clears the date. */
export function setTaskDay(task: Task, day: Date | null, label: string) {
  if (!day) { changeTask(task, { dueDate: null, startDate: null, allDay: true, reminders: [] }, label); return; }
  const d = new Date(day);
  if (task.dueDate && !task.allDay) {
    const old = new Date(task.dueDate);
    d.setHours(old.getHours(), old.getMinutes(), 0, 0);
  } else d.setHours(0, 0, 0, 0);
  changeTask(task, { dueDate: d.toISOString(), startDate: null, allDay: task.dueDate ? task.allDay : true }, label);
}

export function duplicateTask(task: Task): Task {
  const copy: Task = {
    ...task,
    id: crypto.randomUUID(),
    title: task.title,
    status: "open",
    completedAt: null,
    checklist: task.checklist.map((c) => ({ ...c, id: crypto.randomUUID() })),
    sortOrder: task.sortOrder + 0.5,
    createdAt: new Date().toISOString(),
    deleted: false,
    sourceId: null,
  };
  store.save("task", copy.id, copy);
  setUndo({ label: "Duplicated", restore: [], remove: [copy.id] });
  return copy;
}

export function restoreTask(task: Task) {
  store.save("task", task.id, { deleted: false });
}

export function updateTask(id: string, fields: Partial<Task>) {
  store.save("task", id, fields);
}

/** Move a task (and its subtasks) to another list. */
export function moveTask(task: Task, listId: string) {
  const all = [task, ...descendants(allTasks(), task.id)];
  for (const t of all) store.save("task", t.id, { listId, sectionId: null });
}

export function addList(name: string): TaskList {
  const list = createList({ name });
  store.save("list", list.id, list);
  return list;
}

/** Ids of hidden or archived lists, which Today, Tomorrow, Next 7 Days and All leave out. */
export function hiddenListIds(): Set<string> {
  return new Set(allLists().filter((l) => l.hidden || l.archived).map((l) => l.id));
}

export function allFolders() {
  return store.all("folder").filter((f) => !f.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function updateList(id: string, fields: Partial<TaskList>) {
  store.save("list", id, fields);
}

export function deleteList(list: TaskList) {
  for (const t of allTasks().filter((t) => t.listId === list.id && !t.deleted)) store.save("task", t.id, { deleted: true });
  store.save("list", list.id, { deleted: true });
}

export function allTags(): string[] {
  const set = new Set<string>();
  for (const t of allTasks()) if (!t.deleted) for (const g of t.tags) set.add(g);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function sectionsFor(listId: string) {
  return store.all("section").filter((s) => s.listId === listId && !s.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
}

export function addSection(listId: string, name: string) {
  const id = crypto.randomUUID();
  store.save("section", id, { id, listId, name, sortOrder: Date.now(), deleted: false });
}

export function renameSection(id: string, name: string) {
  store.save("section", id, { name });
}

export function deleteSection(id: string) {
  for (const t of allTasks().filter((t) => t.sectionId === id)) store.save("task", t.id, { sectionId: null });
  store.save("section", id, { deleted: true });
}

// --- Notes ------------------------------------------------------------------

export function allPages() {
  return store.all("page").filter((p) => !p.deleted).sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title));
}

export function createPage(parentId: string | null, title = ""): string {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  store.save("page", id, { id, title, icon: null, parentId, content: "", sortOrder: Date.now(), createdAt: now, updatedAt: now, deleted: false, sourceId: null });
  return id;
}

export function updatePage(id: string, fields: Partial<import("@gsd/core").Page>) {
  store.save("page", id, { ...fields, updatedAt: new Date().toISOString() });
}

export function duplicatePage(id: string): string | null {
  const p = store.get("page", id);
  if (!p) return null;
  const copy = crypto.randomUUID();
  const now = new Date().toISOString();
  store.save("page", copy, { ...p, id: copy, title: p.title ? `${p.title} (copy)` : "", sortOrder: p.sortOrder + 0.5, createdAt: now, updatedAt: now, sourceId: null, deleted: false });
  return copy;
}

/** Delete a page and everything under it. */
export function deletePage(id: string) {
  const pages = store.all("page");
  const ids = [id];
  for (let i = 0; i < ids.length; i++) for (const p of pages) if (p.parentId === ids[i] && !p.deleted) ids.push(p.id);
  for (const pid of ids) store.save("page", pid, { deleted: true });
}
