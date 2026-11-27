import { addDays, INBOX_ID, PRIORITY_LABEL, startOfDay, type Priority, type Task } from "@gsd/core";
import {
  allLists,
  changeTask,
  createPage,
  deletePage,
  deleteTask,
  duplicatePage,
  duplicateTask,
  moveTask,
  restoreTask,
  setTaskDay,
  setWontDo,
  toggleComplete,
  updatePage,
} from "./actions";
import type { MenuItem } from "./ContextMenu";
import { splitEmoji } from "./Sidebar";
import { get } from "./store";

const PRIORITY_ICON: Record<Priority, string> = { 5: "🔴", 3: "🟠", 1: "🔵", 0: "⚪" };

/** The right-click menu for a task, modelled on TickTick's. */
export function taskMenu(task: Task, onSelect: (id: string | null) => void): MenuItem[] {
  if (task.deleted) return [{ label: "Restore", icon: "↩", onClick: () => restoreTask(task) }];

  const today = startOfDay(new Date());
  const nextMonday = addDays(today, ((8 - today.getDay()) % 7) || 7);
  const lists = [{ id: INBOX_ID, name: "📥 Inbox" }, ...allLists().filter((l) => !l.hidden)];

  return [
    { label: "Open", icon: "↗", onClick: () => onSelect(task.id) },
    "sep",
    { label: "Today", icon: "☀", onClick: () => setTaskDay(task, today, "Moved to today") },
    { label: "Tomorrow", icon: "→", onClick: () => setTaskDay(task, addDays(today, 1), "Moved to tomorrow") },
    { label: "Next week", icon: "7", onClick: () => setTaskDay(task, nextMonday, "Moved to next week") },
    ...(task.dueDate ? [{ label: "Remove date", icon: "∅", onClick: () => setTaskDay(task, null, "Date removed") }] : []),
    {
      label: "Priority",
      icon: "!",
      items: ([5, 3, 1, 0] as Priority[]).map((p) => ({
        label: PRIORITY_LABEL[p],
        icon: PRIORITY_ICON[p],
        checked: task.priority === p,
        onClick: () => changeTask(task, { priority: p }, `Priority: ${PRIORITY_LABEL[p]}`),
      })),
    },
    {
      label: "Move to",
      icon: "☰",
      items: lists.map((l) => {
        const [icon, name] = splitEmoji(l.name, "☰");
        return { label: name, icon, checked: task.listId === l.id, onClick: () => moveTask(task, l.id) };
      }),
    },
    "sep",
    task.status === "open"
      ? { label: "Complete", icon: "✓", onClick: () => toggleComplete(task) }
      : { label: "Reopen", icon: "↺", onClick: () => toggleComplete(task) },
    ...(task.status === "open" ? [{ label: "Won't do", icon: "✕", onClick: () => setWontDo(task) }] : []),
    { label: "Duplicate", icon: "⧉", onClick: () => onSelect(duplicateTask(task).id) },
    "sep",
    { label: "Delete", icon: "🗑", danger: true, onClick: () => deleteTask(task) },
  ];
}

/** The right-click menu for a note page. */
export function pageMenu(id: string, go: (id: string | null) => void): MenuItem[] {
  const page = get("page", id);
  if (!page) return [];
  return [
    { label: "Open", icon: "↗", onClick: () => go(id) },
    { label: "Add page inside", icon: "＋", onClick: () => go(createPage(id)) },
    "sep",
    { label: "Rename", icon: "✎", onClick: () => { const n = prompt("Rename page", page.title); if (n !== null) updatePage(id, { title: n.trim() }); } },
    { label: "Change icon", icon: page.icon ?? "📄", onClick: () => { const v = prompt("Emoji for this page (leave empty to remove)", page.icon ?? ""); if (v !== null) updatePage(id, { icon: v.trim() || null }); } },
    { label: "Duplicate", icon: "⧉", onClick: () => { const c = duplicatePage(id); if (c) go(c); } },
    "sep",
    {
      label: "Delete",
      icon: "🗑",
      danger: true,
      onClick: () => {
        if (!confirm(`Delete "${page.title || "Untitled"}" and the pages inside it?`)) return;
        deletePage(id);
        if (location.hash.includes(id)) go(page.parentId);
      },
    },
  ];
}
