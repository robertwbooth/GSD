import { useMemo, useState, type DragEvent, type FormEvent } from "react";
import {
  dueLabel,
  groupByDate,
  INBOX_ID,
  listTasks,
  parseQuickAdd,
  PRIORITY_LABEL,
  smartListTasks,
  startOfDay,
  tagTasks,
  type Task,
} from "@gsd/core";
import {
  addSection,
  allLists,
  allTasks,
  deleteList,
  deleteSection,
  quickAdd,
  renameSection,
  restoreTask,
  sectionsFor,
  toggleComplete,
  updateList,
  updateTask,
  type QuickAddContext,
} from "./actions";
import { describeView, type View } from "./view";

function tasksForView(view: View, tasks: Task[]): Task[] {
  switch (view.kind) {
    case "smart": return smartListTasks(view.id, tasks);
    case "list": return listTasks(view.id, tasks);
    case "tag": return tagTasks(view.tag, tasks);
    case "search": {
      const q = view.q.toLowerCase();
      return tasks.filter((t) => !t.deleted && (t.title.toLowerCase().includes(q) || t.description.toLowerCase().includes(q)));
    }
    case "feedback":
    case "import": return [];
  }
}

/** Nest subtasks under their parent when the parent is also shown. */
function buildTree(tasks: Task[]): { roots: Task[]; children: Map<string, Task[]> } {
  const ids = new Set(tasks.map((t) => t.id));
  const children = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const t of tasks) {
    if (t.parentId && ids.has(t.parentId)) {
      const arr = children.get(t.parentId) ?? [];
      arr.push(t);
      children.set(t.parentId, arr);
    } else roots.push(t);
  }
  return { roots, children };
}

export function TaskListView({
  view, selectedId, onSelect, onOpenSidebar,
}: { view: View; selectedId: string | null; onSelect: (id: string | null) => void; onOpenSidebar: () => void }) {
  const tasks = allTasks();
  const lists = allLists();
  const list = view.kind === "list" ? lists.find((l) => l.id === view.id) : undefined;
  const shown = tasksForView(view, tasks);
  const title = describeView(view, (id) => lists.find((l) => l.id === id)?.name);
  const readOnly = view.kind === "smart" && ["completed", "wontdo", "trash"].includes(view.id);
  const [showCompleted, setShowCompleted] = useState(false);
  const [limit, setLimit] = useState(300);

  const ctx: QuickAddContext = {
    listId: view.kind === "list" ? view.id : INBOX_ID,
    dueToday: view.kind === "smart" && view.id === "today",
    dueTomorrow: view.kind === "smart" && view.id === "tomorrow",
    tag: view.kind === "tag" ? view.tag : undefined,
  };

  const completedInList = view.kind === "list"
    ? tasks.filter((t) => t.listId === view.id && !t.deleted && t.status === "completed").sort((a, b) => Date.parse(b.completedAt ?? "0") - Date.parse(a.completedAt ?? "0"))
    : [];

  return (
    <section className="list-pane" aria-label={title}>
      <header className="list-header">
        <button className="icon-btn menu-btn" aria-label="Open menu" onClick={onOpenSidebar}>☰</button>
        <h1>{title}</h1>
        {list && (
          <div className="list-actions">
            <div className="segmented" role="group" aria-label="View">
              <button aria-pressed={list.viewMode === "list"} onClick={() => updateList(list.id, { viewMode: "list" })}>List</button>
              <button aria-pressed={list.viewMode === "board"} onClick={() => updateList(list.id, { viewMode: "board" })}>Board</button>
            </div>
            <ListMenu listId={list.id} name={list.name} />
          </div>
        )}
      </header>
      {!readOnly && list?.viewMode !== "board" && <QuickAdd ctx={ctx} primary />}
      {list?.viewMode === "board" ? (
        <BoardView listId={list.id} tasks={shown} selectedId={selectedId} onSelect={onSelect} />
      ) : (
        <div className="task-scroll">
          {shown.length === 0 && <EmptyState view={view} />}
          {view.kind === "smart" && ["completed", "wontdo", "trash"].includes(view.id) ? (
            <>
              <TaskGroup title={null} tasks={shown.slice(0, limit)} selectedId={selectedId} onSelect={onSelect} trash={view.id === "trash"} />
              {shown.length > limit && (
                <button className="link-btn show-more" onClick={() => setLimit(limit + 300)}>Show more ({shown.length - limit} left)</button>
              )}
            </>
          ) : (
            groupByDate(buildTree(shown).roots).map((g) => (
              <TaskGroup key={g.key} title={g.title} tasks={g.tasks} all={shown} selectedId={selectedId} onSelect={onSelect} overdue={g.key === "overdue"} />
            ))
          )}
          {completedInList.length > 0 && (
            <div className="group">
              <button className="group-title" onClick={() => setShowCompleted(!showCompleted)} aria-expanded={showCompleted}>
                {showCompleted ? "▾" : "▸"} Completed <span className="muted">{completedInList.length}</span>
              </button>
              {showCompleted && completedInList.slice(0, limit).map((t) => <TaskRow key={t.id} task={t} selected={t.id === selectedId} onSelect={onSelect} />)}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function EmptyState({ view }: { view: View }) {
  const msg =
    view.kind === "smart" && view.id === "today" ? "Nothing due today. Enjoy it, or add a task above."
    : view.kind === "search" ? "No tasks match."
    : view.kind === "smart" && view.id === "trash" ? "Trash is empty."
    : "No tasks yet.";
  return <p className="empty">{msg}</p>;
}

function ListMenu({ listId, name }: { listId: string; name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="menu-wrap">
      <button className="icon-btn" aria-label="List options" aria-expanded={open} onClick={() => setOpen(!open)}>⋯</button>
      {open && (
        <div className="menu" role="menu" onMouseLeave={() => setOpen(false)}>
          <button role="menuitem" onClick={() => { const n = prompt("Rename list", name); if (n?.trim()) updateList(listId, { name: n.trim() }); setOpen(false); }}>Rename</button>
          <button role="menuitem" onClick={() => { const n = prompt("Section name"); if (n?.trim()) addSection(listId, n.trim()); setOpen(false); }}>Add section</button>
          <button role="menuitem" className="danger" onClick={() => {
            const list = allLists().find((l) => l.id === listId);
            if (list && confirm(`Delete "${name}" and its tasks? They go to Trash.`)) { deleteList(list); location.hash = "#/inbox"; }
            setOpen(false);
          }}>Delete list</button>
        </div>
      )}
    </div>
  );
}

export function QuickAdd({ ctx, placeholder, primary }: { ctx: QuickAddContext; placeholder?: string; primary?: boolean }) {
  const [text, setText] = useState("");
  const preview = useMemo(() => (text.trim() ? parseQuickAdd(text, { lists: allLists() }) : null), [text]);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (quickAdd(text, ctx)) setText("");
  }

  return (
    <form className="quick-add" onSubmit={submit}>
      <input
        id={primary ? "quick-add" : undefined}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder ?? 'Add task, e.g. "Call mum tomorrow 5pm !high #family"'}
        aria-label="Add task"
        autoComplete="off"
      />
      {preview && (preview.dueDate || preview.priority || preview.tags.length || preview.listName || preview.repeat) ? (
        <div className="chips" aria-live="polite">
          {preview.dueDate && <span className="chip">📅 {dueLabel(preview.dueDate, preview.allDay)}</span>}
          {preview.repeat && <span className="chip">🔁 repeats</span>}
          {preview.priority > 0 && <span className={`chip p${preview.priority}`}>! {PRIORITY_LABEL[preview.priority]}</span>}
          {preview.tags.map((t) => <span key={t} className="chip">#{t}</span>)}
          {preview.listName && <span className="chip">☰ {preview.listName}{preview.listId ? "" : " (new)"}</span>}
        </div>
      ) : null}
    </form>
  );
}

function TaskGroup({
  title, tasks, all, selectedId, onSelect, overdue, trash,
}: { title: string | null; tasks: Task[]; all?: Task[]; selectedId: string | null; onSelect: (id: string | null) => void; overdue?: boolean; trash?: boolean }) {
  const [open, setOpen] = useState(true);
  const tree = buildTree(all ?? tasks);
  return (
    <div className="group">
      {title && (
        <button className={`group-title${overdue ? " overdue" : ""}`} onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "▾" : "▸"} {title} <span className="muted">{tasks.length}</span>
        </button>
      )}
      {open && tasks.map((t) => (
        <TaskRow key={t.id} task={t} selected={t.id === selectedId} onSelect={onSelect} childMap={tree.children} selectedId={selectedId} trash={trash} />
      ))}
    </div>
  );
}

export function TaskRow({
  task, selected, onSelect, childMap, selectedId, depth = 0, trash, draggable,
}: {
  task: Task; selected: boolean; onSelect: (id: string | null) => void; childMap?: Map<string, Task[]>;
  selectedId?: string | null; depth?: number; trash?: boolean; draggable?: boolean;
}) {
  const kids = childMap?.get(task.id) ?? [];
  const [expanded, setExpanded] = useState(true);
  const listName = allLists().find((l) => l.id === task.listId)?.name;
  const overdue = task.status === "open" && task.dueDate && (task.allDay ? startOfDay(new Date(task.dueDate)) < startOfDay(new Date()) : new Date(task.dueDate) < new Date());
  const doneChecks = task.checklist.filter((c) => c.done).length;

  return (
    <>
      <div
        className={`task-row${selected ? " selected" : ""}${task.status !== "open" ? " done" : ""}`}
        style={{ paddingLeft: 12 + depth * 24 }}
        onClick={() => onSelect(task.id)}
        draggable={draggable}
        onDragStart={(e: DragEvent) => e.dataTransfer.setData("text/task-id", task.id)}
        data-testid="task-row"
      >
        {kids.length > 0 ? (
          <button className="expander" aria-label={expanded ? "Collapse subtasks" : "Expand subtasks"} onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}>
            {expanded ? "▾" : "▸"}
          </button>
        ) : <span className="expander" />}
        {trash ? (
          <button className="link-btn" onClick={(e) => { e.stopPropagation(); restoreTask(task); }}>Restore</button>
        ) : (
          <input
            type="checkbox"
            className={`check p${task.priority}`}
            checked={task.status !== "open"}
            aria-label={`Complete ${task.title}`}
            onClick={(e) => e.stopPropagation()}
            onChange={() => toggleComplete(task)}
          />
        )}
        <span className="task-title">{task.title || <span className="muted">Untitled</span>}</span>
        <span className="task-meta">
          {task.checklist.length > 0 && <span className="muted">☑ {doneChecks}/{task.checklist.length}</span>}
          {task.tags.map((t) => <span key={t} className="tag">#{t}</span>)}
          {task.repeat && <span title="Repeats" aria-label="Repeats">🔁</span>}
          {listName && depth === 0 && <span className="muted list-name">{listName}</span>}
          {task.dueDate && <span className={overdue ? "overdue" : "due"}>{dueLabel(task.dueDate, task.allDay)}</span>}
        </span>
      </div>
      {expanded && kids.map((k) => (
        <TaskRow key={k.id} task={k} selected={k.id === selectedId} onSelect={onSelect} childMap={childMap} selectedId={selectedId} depth={depth + 1} />
      ))}
    </>
  );
}

function BoardView({ listId, tasks, selectedId, onSelect }: { listId: string; tasks: Task[]; selectedId: string | null; onSelect: (id: string | null) => void }) {
  const sections = sectionsFor(listId);
  const roots = buildTree(tasks).roots;
  const columns = [{ id: null as string | null, name: "Not sectioned" }, ...sections];
  const [over, setOver] = useState<string | null | undefined>(undefined);

  function drop(e: DragEvent, sectionId: string | null) {
    e.preventDefault();
    const id = e.dataTransfer.getData("text/task-id");
    if (id) updateTask(id, { sectionId });
    setOver(undefined);
  }

  return (
    <div className="board">
      {columns.map((col) => {
        const colTasks = roots.filter((t) => (t.sectionId ?? null) === col.id || (col.id === null && t.sectionId && !sections.some((s) => s.id === t.sectionId)));
        return (
          <div
            key={col.id ?? "none"}
            className={`column${over === col.id ? " drop" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setOver(col.id); }}
            onDragLeave={() => setOver(undefined)}
            onDrop={(e) => drop(e, col.id)}
            data-testid="board-column"
            aria-label={col.name}
          >
            <div className="column-head">
              <span>{col.name}</span>
              <span className="muted">{colTasks.length}</span>
              {col.id && (
                <span className="column-actions">
                  <button className="icon-btn" aria-label={`Rename ${col.name}`} onClick={() => { const n = prompt("Rename section", col.name); if (n?.trim()) renameSection(col.id!, n.trim()); }}>✎</button>
                  <button className="icon-btn" aria-label={`Delete ${col.name}`} onClick={() => confirm(`Delete section "${col.name}"? Its tasks stay in the list.`) && deleteSection(col.id!)}>✕</button>
                </span>
              )}
            </div>
            <QuickAdd ctx={{ listId, sectionId: col.id }} placeholder="Add task" />
            {colTasks.map((t) => (
              <div key={t.id} className="card">
                <TaskRow task={t} selected={t.id === selectedId} onSelect={onSelect} draggable />
              </div>
            ))}
          </div>
        );
      })}
      <button className="add-column" onClick={() => { const n = prompt("Section name"); if (n?.trim()) addSection(listId, n.trim()); }}>+ Add section</button>
    </div>
  );
}
