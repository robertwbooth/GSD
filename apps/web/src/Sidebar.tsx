import { useState, type FormEvent } from "react";
import { INBOX_ID, smartListTasks, listTasks, tagTasks, type Task } from "@gsd/core";
import { addList, allLists, allTags, allTasks } from "./actions";
import { logout, pendingChanges, sync } from "./store";
import { useSyncState } from "./hooks";
import { viewHash, type View } from "./view";

const SMART_ITEMS = [
  { id: "today", name: "Today", icon: "☀" },
  { id: "tomorrow", name: "Tomorrow", icon: "→" },
  { id: "next7", name: "Next 7 Days", icon: "7" },
  { id: "inbox", name: "Inbox", icon: "📥" },
] as const;
const BOTTOM_ITEMS = [
  { id: "all", name: "All", icon: "≡" },
  { id: "completed", name: "Completed", icon: "✓" },
  { id: "wontdo", name: "Won't Do", icon: "✕" },
  { id: "trash", name: "Trash", icon: "🗑" },
] as const;

function topLevelCount(tasks: Task[]) {
  return tasks.filter((t) => !t.parentId || !tasks.some((p) => p.id === t.parentId)).length;
}

export function Sidebar({ view, onNavigate }: { view: View; onNavigate: () => void }) {
  const tasks = allTasks();
  const lists = allLists();
  const tags = allTags();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const state = useSyncState();

  const active = (v: View) => viewHash(v) === viewHash(view);
  const link = (v: View, label: string, icon: string, count?: number) => (
    <a key={viewHash(v)} href={viewHash(v)} className={`nav-item${active(v) ? " active" : ""}`} onClick={onNavigate}>
      <span className="nav-icon" aria-hidden>{icon}</span>
      <span className="nav-label">{label}</span>
      {!!count && <span className="nav-count">{count}</span>}
    </a>
  );

  function submitList(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const list = addList(name.trim());
    setName("");
    setAdding(false);
    location.hash = viewHash({ kind: "list", id: list.id });
    onNavigate();
  }

  function submitSearch(e: FormEvent) {
    e.preventDefault();
    if (search.trim()) {
      location.hash = viewHash({ kind: "search", q: search.trim() });
      onNavigate();
    }
  }

  const syncLabel = {
    idle: pendingChanges() ? "Waiting to sync" : "Synced",
    syncing: "Syncing…",
    offline: "Offline: changes saved on this device",
    error: "Can't reach server: changes saved on this device",
    "signed-out": "Signed out",
  }[state];

  return (
    <nav className="sidebar" aria-label="Lists">
      <form onSubmit={submitSearch} className="search">
        <input type="search" placeholder="Search" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search tasks" />
      </form>
      <div className="nav-group">
        {SMART_ITEMS.map((s) =>
          link({ kind: "smart", id: s.id }, s.name, s.icon, topLevelCount(s.id === "inbox" ? listTasks(INBOX_ID, tasks) : smartListTasks(s.id, tasks))),
        )}
      </div>
      <div className="nav-heading">
        <span>Lists</span>
        <button className="icon-btn" aria-label="Add list" onClick={() => setAdding(true)}>+</button>
      </div>
      <div className="nav-group">
        {lists.map((l) => link({ kind: "list", id: l.id }, l.name, "☰", topLevelCount(listTasks(l.id, tasks))))}
        {adding && (
          <form onSubmit={submitList} className="nav-add">
            <input autoFocus placeholder="List name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name && setAdding(false)} aria-label="New list name" />
          </form>
        )}
      </div>
      {tags.length > 0 && (
        <>
          <div className="nav-heading"><span>Tags</span></div>
          <div className="nav-group">{tags.map((t) => link({ kind: "tag", tag: t }, t, "#", topLevelCount(tagTasks(t, tasks))))}</div>
        </>
      )}
      <div className="nav-group nav-bottom">
        {BOTTOM_ITEMS.map((s) => link({ kind: "smart", id: s.id }, s.name, s.icon))}
        {link({ kind: "feedback" }, "Feedback", "💬")}
      </div>
      <div className="sync-status">
        <button className="link-btn" onClick={() => void sync()} title="Sync now">{syncLabel}</button>
        <button className="link-btn" onClick={() => void logout()}>Sign out</button>
      </div>
    </nav>
  );
}
