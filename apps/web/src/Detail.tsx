import { useEffect, useRef, useState } from "react";
import { describeRepeat, descendants, INBOX_ID, newId, PRIORITY_LABEL, repeatHistory, type Priority, type Repeat, type Task } from "@gsd/core";
import { addSubtask, allLists, allTasks, deleteTask, moveTask, restoreTask, setWontDo, toggleComplete, updateTask } from "./actions";
import { get } from "./store";
import { TaskRow } from "./TaskList";

/** Text input that saves after a pause and on blur, so typing doesn't flood the sync log. */
function useDraft(value: string, commit: (v: string) => void, delay = 600) {
  const [draft, setDraft] = useState(value);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
    latest.current = value;
  }, [value]);
  const flush = (v: string) => {
    if (timer.current) clearTimeout(timer.current);
    if (v !== latest.current) {
      latest.current = v;
      commit(v);
    }
  };
  return {
    value: draft,
    onChange: (v: string) => {
      setDraft(v);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => flush(v), delay);
    },
    onFocus: () => { focused.current = true; },
    onBlur: () => { focused.current = false; flush(draft); },
  };
}

const pad = (n: number) => String(n).padStart(2, "0");
const toDateInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

const WEEKDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

function repeatPresets(due: Date | null): { label: string; rrule: string }[] {
  const wd = WEEKDAY[(due ?? new Date()).getDay()];
  return [
    { label: "Daily", rrule: "FREQ=DAILY" },
    { label: "Weekdays", rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
    { label: "Weekly", rrule: `FREQ=WEEKLY;BYDAY=${wd}` },
    { label: "Monthly", rrule: "FREQ=MONTHLY" },
    { label: "Yearly", rrule: "FREQ=YEARLY" },
  ];
}

export function Detail({ id, onClose, onSelect }: { id: string; onClose: () => void; onSelect: (id: string | null) => void }) {
  const task = get("task", id);
  if (!task) return <aside className="detail empty-detail"><p className="muted">Task not found.</p></aside>;
  return <DetailInner key={task.id} task={task} onClose={onClose} onSelect={onSelect} />;
}

function DetailInner({ task, onClose, onSelect }: { task: Task; onClose: () => void; onSelect: (id: string | null) => void }) {
  const title = useDraft(task.title, (v) => updateTask(task.id, { title: v }));
  const desc = useDraft(task.description, (v) => updateTask(task.id, { description: v }));
  const [tagText, setTagText] = useState("");
  const [checkText, setCheckText] = useState("");
  const due = task.dueDate ? new Date(task.dueDate) : null;
  const lists = allLists();
  const all = allTasks();
  const subtasks = all.filter((t) => t.parentId === task.id && !t.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
  const history = task.repeat ? repeatHistory(task, all) : [];
  const parent = task.parentId ? all.find((t) => t.id === task.parentId) : undefined;
  const subtree = new Map<string, Task[]>();
  for (const t of [task, ...descendants(all, task.id)]) {
    subtree.set(t.id, all.filter((c) => c.parentId === t.id && !c.deleted).sort((a, b) => a.sortOrder - b.sortOrder));
  }

  function setDate(date: string, time: string) {
    if (!date) { updateTask(task.id, { dueDate: null, allDay: true, repeat: null }); return; }
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const [hh, mm] = time ? (time.split(":").map(Number) as [number, number]) : [0, 0];
    updateTask(task.id, { dueDate: new Date(y, m - 1, d, hh, mm).toISOString(), allDay: !time });
  }

  function setRepeat(r: Repeat | null) {
    if (r && !task.dueDate) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      updateTask(task.id, { repeat: r, dueDate: today.toISOString(), allDay: true });
    } else updateTask(task.id, { repeat: r });
  }

  function addTags() {
    const next = tagText.split(/[,\s]+/).map((t) => t.replace(/^#/, "").trim()).filter(Boolean);
    if (next.length) updateTask(task.id, { tags: [...new Set([...task.tags, ...next])] });
    setTagText("");
  }

  const presets = repeatPresets(due);
  const presetValue = task.repeat ? (presets.find((p) => p.rrule === task.repeat!.rrule)?.rrule ?? "custom") : "";

  return (
    <aside className="detail" aria-label="Task details">
      <div className="detail-top">
        <button className="icon-btn back-btn" aria-label="Close details" onClick={onClose}>←</button>
        <input
          type="checkbox"
          className={`check p${task.priority}`}
          checked={task.status !== "open"}
          onChange={() => toggleComplete(task)}
          aria-label="Complete task"
        />
        <div className="date-fields">
          <input type="date" aria-label="Due date" value={due ? toDateInput(due) : ""} onChange={(e) => setDate(e.target.value, due && !task.allDay ? toTimeInput(due) : "")} />
          {due && (
            <input type="time" aria-label="Due time" value={!task.allDay ? toTimeInput(due) : ""} onChange={(e) => setDate(toDateInput(due), e.target.value)} />
          )}
        </div>
        <select aria-label="Priority" className={`priority p${task.priority}`} value={task.priority} onChange={(e) => updateTask(task.id, { priority: Number(e.target.value) as Priority })}>
          {([5, 3, 1, 0] as Priority[]).map((p) => <option key={p} value={p}>{p ? `${PRIORITY_LABEL[p]} priority` : "No priority"}</option>)}
        </select>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>✕</button>
      </div>

      {parent && (
        <button className="link-btn parent-link" onClick={() => onSelect(parent.id)}>↑ {parent.title}</button>
      )}

      <input className="detail-title" aria-label="Title" placeholder="What needs doing?" {...bind(title)} />

      <div className="detail-row">
        <label className="field">
          <span>Repeat</span>
          <select
            aria-label="Repeat"
            value={presetValue}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) setRepeat(null);
              else if (v === "custom") {
                const r = prompt("Repeat rule (RRULE), e.g. FREQ=WEEKLY;INTERVAL=2;BYDAY=MO", task.repeat?.rrule ?? "FREQ=WEEKLY;INTERVAL=2");
                if (r) setRepeat({ rrule: r.replace(/^RRULE:/i, ""), fromCompletion: task.repeat?.fromCompletion });
              } else setRepeat({ rrule: v, fromCompletion: task.repeat?.fromCompletion });
            }}
          >
            <option value="">Doesn't repeat</option>
            {presets.map((p) => <option key={p.rrule} value={p.rrule}>{p.label}</option>)}
            <option value="custom">{presetValue === "custom" ? describeRepeat(task.repeat!) : "Custom…"}</option>
          </select>
        </label>
        {task.repeat && (
          <label className="field inline">
            <input type="checkbox" checked={!!task.repeat.fromCompletion} onChange={(e) => setRepeat({ ...task.repeat!, fromCompletion: e.target.checked })} />
            <span>From completion date</span>
          </label>
        )}
      </div>

      <div className="detail-row tags-row">
        {task.tags.map((t) => (
          <span key={t} className="tag removable">
            #{t}
            <button aria-label={`Remove tag ${t}`} onClick={() => updateTask(task.id, { tags: task.tags.filter((x) => x !== t) })}>×</button>
          </span>
        ))}
        <input
          className="tag-input"
          placeholder="Add tags"
          aria-label="Add tags"
          value={tagText}
          onChange={(e) => setTagText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTags(); } }}
          onBlur={addTags}
        />
      </div>

      <textarea className="detail-desc" aria-label="Description" placeholder="Notes" {...bind(desc)} />

      <div className="checklist">
        {task.checklist.map((c) => (
          <div key={c.id} className="check-item">
            <input
              type="checkbox"
              checked={c.done}
              aria-label={`Check ${c.title}`}
              onChange={() => updateTask(task.id, { checklist: task.checklist.map((x) => (x.id === c.id ? { ...x, done: !x.done } : x)) })}
            />
            <input
              className={c.done ? "done-text" : ""}
              defaultValue={c.title}
              aria-label="Checklist item"
              onBlur={(e) => e.target.value !== c.title && updateTask(task.id, { checklist: task.checklist.map((x) => (x.id === c.id ? { ...x, title: e.target.value } : x)) })}
            />
            <button className="icon-btn" aria-label={`Remove ${c.title}`} onClick={() => updateTask(task.id, { checklist: task.checklist.filter((x) => x.id !== c.id) })}>×</button>
          </div>
        ))}
        <form
          className="check-item"
          onSubmit={(e) => {
            e.preventDefault();
            if (!checkText.trim()) return;
            updateTask(task.id, { checklist: [...task.checklist, { id: newId(), title: checkText.trim(), done: false }] });
            setCheckText("");
          }}
        >
          <span className="check-plus">+</span>
          <input placeholder="Add checklist item" aria-label="Add checklist item" value={checkText} onChange={(e) => setCheckText(e.target.value)} />
        </form>
      </div>

      <div className="subtasks">
        <h2>Subtasks</h2>
        {subtasks.map((s) => (
          <TaskRow key={s.id} task={s} selected={false} onSelect={onSelect} childMap={subtree} />
        ))}
        <SubtaskAdd parent={task} />
      </div>

      {history.length > 0 && <RepeatHistory history={history} onSelect={onSelect} />}

      <footer className="detail-footer">
        <select aria-label="List" value={task.listId} onChange={(e) => moveTask(task, e.target.value)}>
          <option value={INBOX_ID}>Inbox</option>
          {lists.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select>
        <span className="spacer" />
        {task.deleted ? (
          <button className="link-btn" onClick={() => restoreTask(task)}>Restore</button>
        ) : (
          <>
            {task.status === "open" && <button className="link-btn" onClick={() => setWontDo(task)}>Won't do</button>}
            <button className="link-btn danger" onClick={() => { deleteTask(task); onClose(); }}>Delete</button>
          </>
        )}
      </footer>
    </aside>
  );
}

function SubtaskAdd({ parent }: { parent: Task }) {
  const [text, setText] = useState("");
  return (
    <form className="quick-add sub" onSubmit={(e) => { e.preventDefault(); if (addSubtask(parent, text)) setText(""); }}>
      <input placeholder="Add subtask" aria-label="Add subtask" value={text} onChange={(e) => setText(e.target.value)} />
    </form>
  );
}

function bind(d: ReturnType<typeof useDraft>) {
  return {
    value: d.value,
    onChange: (e: { target: { value: string } }) => d.onChange(e.target.value),
    onFocus: d.onFocus,
    onBlur: d.onBlur,
  };
}


function RepeatHistory({ history, onSelect }: { history: Task[]; onSelect: (id: string | null) => void }) {
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(10);
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "No date");
  return (
    <div className="repeat-history">
      <button className="group-title" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} History <span className="muted">{history.length} done</span>
      </button>
      {open && (
        <ul>
          {history.slice(0, limit).map((h) => (
            <li key={h.id}>
              <button className="link-btn" onClick={() => onSelect(h.id)}>
                {h.status === "wontdo" ? "✕" : "✓"} {fmt(h.completedAt)}
              </button>
              {h.dueDate && <span className="muted"> for {fmt(h.dueDate)}</span>}
            </li>
          ))}
          {history.length > limit && (
            <li><button className="link-btn" onClick={() => setLimit(limit + 20)}>Show more ({history.length - limit} left)</button></li>
          )}
        </ul>
      )}
    </div>
  );
}
