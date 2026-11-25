import { addDays, endOfDay, startOfDay } from "./dates.js";
import { compareTasks } from "./tasks.js";
import { INBOX_ID, type FilterRule, type Task } from "./types.js";

export const SMART_LISTS = [
  { id: "today", name: "Today" },
  { id: "tomorrow", name: "Tomorrow" },
  { id: "next7", name: "Next 7 Days" },
  { id: "inbox", name: "Inbox" },
  { id: "all", name: "All" },
  { id: "completed", name: "Completed" },
  { id: "wontdo", name: "Won't Do" },
  { id: "trash", name: "Trash" },
] as const;

export type SmartListId = (typeof SMART_LISTS)[number]["id"];

const open = (t: Task) => !t.deleted && t.status === "open";

function dueIn(t: Task, from: Date | null, to: Date): boolean {
  if (!t.dueDate) return false;
  const d = Date.parse(t.dueDate);
  return (from === null || d >= from.getTime()) && d <= to.getTime();
}

export function matchesDue(t: Task, due: FilterRule["due"], now: Date): boolean {
  const today = startOfDay(now);
  switch (due) {
    case "any": return true;
    case "nodate": return !t.dueDate;
    case "overdue": return dueIn(t, null, new Date(today.getTime() - 1));
    case "today": return dueIn(t, null, endOfDay(now));
    case "tomorrow": return dueIn(t, addDays(today, 1), endOfDay(addDays(today, 1)));
    case "next7": return dueIn(t, null, endOfDay(addDays(today, 6)));
  }
}

export function matchesRule(t: Task, rule: FilterRule, now: Date): boolean {
  if (!open(t)) return false;
  const checks: boolean[] = [];
  if (rule.listIds.length) checks.push(rule.listIds.includes(t.listId));
  if (rule.tags.length) checks.push(rule.tags.some((g) => t.tags.some((tg) => tg === g || tg.startsWith(g + "/"))));
  if (rule.priorities.length) checks.push(rule.priorities.includes(t.priority));
  if (rule.due !== "any") checks.push(matchesDue(t, rule.due, now));
  if (rule.keyword.trim()) {
    const k = rule.keyword.trim().toLowerCase();
    checks.push(t.title.toLowerCase().includes(k) || t.description.toLowerCase().includes(k));
  }
  if (!checks.length) return true;
  return rule.match === "all" ? checks.every(Boolean) : checks.some(Boolean);
}

/** Tasks shown in a built-in smart list. Today, Tomorrow and Next 7 Days include overdue tasks like TickTick. */
export function smartListTasks(id: SmartListId, tasks: Task[], now = new Date()): Task[] {
  let out: Task[];
  switch (id) {
    case "today": out = tasks.filter((t) => open(t) && matchesDue(t, "today", now)); break;
    case "tomorrow": out = tasks.filter((t) => open(t) && matchesDue(t, "tomorrow", now)); break;
    case "next7": out = tasks.filter((t) => open(t) && matchesDue(t, "next7", now)); break;
    case "inbox": out = tasks.filter((t) => open(t) && t.listId === INBOX_ID); break;
    case "all": out = tasks.filter(open); break;
    case "completed":
      return tasks
        .filter((t) => !t.deleted && t.status === "completed")
        .sort((a, b) => Date.parse(b.completedAt ?? "0") - Date.parse(a.completedAt ?? "0"));
    case "wontdo": out = tasks.filter((t) => !t.deleted && t.status === "wontdo"); break;
    case "trash": out = tasks.filter((t) => t.deleted); break;
  }
  return out.sort(compareTasks);
}

export function listTasks(listId: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => open(t) && t.listId === listId).sort(compareTasks);
}

export function filterTasks(rule: FilterRule, tasks: Task[], now = new Date()): Task[] {
  return tasks.filter((t) => matchesRule(t, rule, now)).sort(compareTasks);
}

export function tagTasks(tag: string, tasks: Task[]): Task[] {
  return tasks.filter((t) => open(t) && t.tags.some((g) => g === tag || g.startsWith(tag + "/"))).sort(compareTasks);
}

/** Group dated tasks into TickTick-style sections: Overdue, Today, Tomorrow, Next 7 Days, Later, No Date. */
export function groupByDate(tasks: Task[], now = new Date()): { key: string; title: string; tasks: Task[] }[] {
  const today = startOfDay(now).getTime();
  const day = 86_400_000;
  const groups: Record<string, Task[]> = { overdue: [], today: [], tomorrow: [], next7: [], later: [], nodate: [] };
  for (const t of tasks) {
    if (!t.dueDate) { groups.nodate!.push(t); continue; }
    const d = startOfDay(new Date(t.dueDate)).getTime();
    if (d < today) groups.overdue!.push(t);
    else if (d === today) groups.today!.push(t);
    else if (d === today + day) groups.tomorrow!.push(t);
    else if (d < today + 7 * day) groups.next7!.push(t);
    else groups.later!.push(t);
  }
  const titles: Record<string, string> = {
    overdue: "Overdue", today: "Today", tomorrow: "Tomorrow", next7: "Next 7 Days", later: "Later", nodate: "No Date",
  };
  return Object.entries(groups)
    .filter(([, ts]) => ts.length)
    .map(([key, ts]) => ({ key, title: titles[key]!, tasks: ts }));
}
