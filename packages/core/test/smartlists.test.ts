import { describe, expect, it } from "vitest";
import { createTask } from "../src/tasks.js";
import { filterTasks, groupByDate, smartListTasks, tagTasks } from "../src/smartlists.js";
import type { Task } from "../src/types.js";

const now = new Date(2026, 10, 25, 9, 0);
const day = (n: number) => new Date(2026, 10, 25 + n).toISOString();

const tasks: Task[] = [
  createTask({ title: "overdue", dueDate: day(-2), listId: "work" }),
  createTask({ title: "today", dueDate: day(0), priority: 5, tags: ["work/admin"] }),
  createTask({ title: "tomorrow", dueDate: day(1), listId: "work" }),
  createTask({ title: "in5", dueDate: day(5) }),
  createTask({ title: "in10", dueDate: day(10) }),
  createTask({ title: "nodate" }),
  createTask({ title: "done", dueDate: day(0), status: "completed", completedAt: day(0) }),
  createTask({ title: "deleted", dueDate: day(0), deleted: true }),
  createTask({ title: "wontdo", status: "wontdo" }),
];
const titles = (ts: Task[]) => ts.map((t) => t.title);

describe("smart lists", () => {
  it("Today includes overdue", () => expect(titles(smartListTasks("today", tasks, now))).toEqual(["overdue", "today"]));
  it("Tomorrow is only tomorrow", () => expect(titles(smartListTasks("tomorrow", tasks, now))).toEqual(["tomorrow"]));
  it("Next 7 Days", () =>
    expect(titles(smartListTasks("next7", tasks, now))).toEqual(["overdue", "today", "tomorrow", "in5"]));
  it("Inbox", () => expect(titles(smartListTasks("inbox", tasks, now))).toEqual(["today", "in5", "in10", "nodate"]));
  it("Completed, Won't Do, Trash", () => {
    expect(titles(smartListTasks("completed", tasks, now))).toEqual(["done"]);
    expect(titles(smartListTasks("wontdo", tasks, now))).toEqual(["wontdo"]);
    expect(titles(smartListTasks("trash", tasks, now))).toEqual(["deleted"]);
  });
});

describe("filters and tags", () => {
  it("matches all conditions", () => {
    const r = filterTasks(
      { listIds: ["work"], tags: [], priorities: [], due: "next7", keyword: "", match: "all" },
      tasks,
      now,
    );
    expect(titles(r)).toEqual(["overdue", "tomorrow"]);
  });
  it("matches any condition", () => {
    const r = filterTasks(
      { listIds: [], tags: ["work"], priorities: [], due: "nodate", keyword: "", match: "any" },
      tasks,
      now,
    );
    expect(titles(r)).toEqual(["today", "nodate"]);
  });
  it("parent tags include nested tags", () => expect(titles(tagTasks("work", tasks))).toEqual(["today"]));
});

describe("groupByDate", () => {
  it("groups into TickTick sections", () => {
    const open = smartListTasks("all", tasks, now);
    expect(groupByDate(open, now).map((g) => [g.title, g.tasks.length])).toEqual([
      ["Overdue", 1], ["Today", 1], ["Tomorrow", 1], ["Next 7 Days", 1], ["Later", 1], ["No Date", 1],
    ]);
  });
});
