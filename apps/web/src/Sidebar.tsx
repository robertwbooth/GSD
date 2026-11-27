import { useState, type FormEvent, type ReactNode } from "react";
import { INBOX_ID, smartListTasks, listTasks, tagTasks, type Task, type TaskList } from "@gsd/core";
import { addList, allFolders, allLists, allTags, allTasks, deleteList, hiddenListIds, updateList } from "./actions";
import { openContextMenu, type MenuItem } from "./ContextMenu";
import { COLLAPSED, HIDDEN_TAGS, toggleInSet, usePrefSet } from "./prefs";
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

/** "🚴Cycling" → ["🚴", "Cycling"], so a leading emoji becomes the icon like in TickTick. */
const EMOJI = /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:\uFE0F|\u200D(?:\p{Extended_Pictographic}|♂|♀)|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}])*\uFE0F?)\s*(.*)$/u;
export function splitEmoji(name: string, fallback: string): [string, string] {
  const m = name.match(EMOJI);
  return m && m[2] ? [m[1]!, m[2]] : [fallback, name];
}

function topLevelCount(tasks: Task[]) {
  return tasks.filter((t) => !t.parentId || !tasks.some((p) => p.id === t.parentId)).length;
}

export function Sidebar({ view, onNavigate }: { view: View; onNavigate: () => void }) {
  const tasks = allTasks();
  const allListsShown = allLists();
  const lists = allListsShown.filter((l) => !l.hidden);
  const hiddenLists = allListsShown.filter((l) => l.hidden);
  const hiddenTags = usePrefSet(HIDDEN_TAGS);
  const tagsAll = allTags();
  const tags = tagsAll.filter((t) => !hiddenTags.has(t));
  const tagsHidden = tagsAll.filter((t) => hiddenTags.has(t));
  const folders = allFolders();
  const hidden = hiddenListIds();
  // Folder ids and "section:*" keys that are collapsed on this device.
  const collapsed = usePrefSet(COLLAPSED);
  const toggleFolder = (id: string) => toggleInSet(COLLAPSED, id);
  const isOpen = (key: string, byDefault = true) => (byDefault ? !collapsed.has(key) : collapsed.has(`${key}:open`));
  const toggleSection = (key: string, byDefault = true) => toggleInSet(COLLAPSED, byDefault ? key : `${key}:open`);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [search, setSearch] = useState("");
  const state = useSyncState();

  const active = (v: View) => viewHash(v) === viewHash(view) || (v.kind === "notes" && view.kind === "notes");
  const link = (v: View, label: string, icon: string, count?: number, menu?: MenuItem[], extraClass = "") => (
    <a
      key={viewHash(v)}
      href={viewHash(v)}
      className={`nav-item${active(v) ? " active" : ""}${extraClass}`}
      onClick={onNavigate}
      onContextMenu={menu ? (e) => openContextMenu(e, menu, label) : undefined}
    >
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

  function listLink(l: TaskList) {
    const [icon, label] = splitEmoji(l.name, "☰");
    const menu: MenuItem[] = [
      { label: "Rename", icon: "✎", onClick: () => { const n = prompt("Rename list", l.name); if (n?.trim()) updateList(l.id, { name: n.trim() }); } },
      l.hidden
        ? { label: "Show list", icon: "👁", onClick: () => updateList(l.id, { hidden: false }) }
        : { label: "Hide list", icon: "🙈", onClick: () => updateList(l.id, { hidden: true }) },
      "sep",
      { label: "Delete list", icon: "🗑", danger: true, onClick: () => { if (confirm(`Delete "${l.name}" and its tasks? They go to Trash.`)) { deleteList(l); if (active({ kind: "list", id: l.id })) location.hash = "#/inbox"; } } },
    ];
    return link({ kind: "list", id: l.id }, label, icon, topLevelCount(listTasks(l.id, tasks)), menu, l.hidden ? " hidden-item" : "");
  }

  function tagLink(t: string, isHidden: boolean) {
    const menu: MenuItem[] = [
      isHidden
        ? { label: "Show tag", icon: "👁", onClick: () => toggleInSet(HIDDEN_TAGS, t, false) }
        : { label: "Hide tag", icon: "🙈", onClick: () => toggleInSet(HIDDEN_TAGS, t, true) },
    ];
    return link({ kind: "tag", tag: t }, t, "#", topLevelCount(tagTasks(t, tasks)), menu, isHidden ? " hidden-item" : "");
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
          link({ kind: "smart", id: s.id }, s.name, s.icon, topLevelCount(s.id === "inbox" ? listTasks(INBOX_ID, tasks) : smartListTasks(s.id, tasks, new Date(), hidden))),
        )}
      </div>
      <div className="nav-group">
        {link({ kind: "notes", id: null }, "Notes", "📝")}
      </div>
      <div className="nav-heading">
        <SectionToggle open={isOpen("section:lists")} onToggle={() => toggleSection("section:lists")}>Lists</SectionToggle>
        <button className="icon-btn" aria-label="Add list" onClick={() => { if (!isOpen("section:lists")) toggleSection("section:lists"); setAdding(true); }}>+</button>
      </div>
      {isOpen("section:lists") && <div className="nav-group">
        {folders.map((f) => {
          const inFolder = lists.filter((l) => l.folderId === f.id);
          if (!inFolder.length) return null;
          const open = !collapsed.has(f.id);
          return (
            <div key={f.id} className="folder">
              <button className="nav-item folder-head" aria-expanded={open} onClick={() => toggleFolder(f.id)}>
                <span className="nav-icon" aria-hidden>{open ? "▾" : "▸"}</span>
                <span className="nav-label">{f.name}</span>
              </button>
              {open && <div className="folder-lists">{inFolder.map(listLink)}</div>}
            </div>
          );
        })}
        {lists.filter((l) => !l.folderId || !folders.some((f) => f.id === l.folderId)).map(listLink)}
        {adding && (
          <form onSubmit={submitList} className="nav-add">
            <input autoFocus placeholder="List name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => !name && setAdding(false)} aria-label="New list name" />
          </form>
        )}
        {hiddenLists.length > 0 && (
          <div className="folder">
            <button className="nav-item folder-head" aria-expanded={isOpen("section:hidden-lists", false)} onClick={() => toggleSection("section:hidden-lists", false)}>
              <span className="nav-icon" aria-hidden>{isOpen("section:hidden-lists", false) ? "▾" : "▸"}</span>
              <span className="nav-label">Hidden lists</span>
              <span className="nav-count">{hiddenLists.length}</span>
            </button>
            {isOpen("section:hidden-lists", false) && <div className="folder-lists">{hiddenLists.map(listLink)}</div>}
          </div>
        )}
      </div>}
      {tagsAll.length > 0 && (
        <>
          <div className="nav-heading">
            <SectionToggle open={isOpen("section:tags")} onToggle={() => toggleSection("section:tags")}>Tags</SectionToggle>
          </div>
          {isOpen("section:tags") && (
            <div className="nav-group">
              {tags.map((t) => tagLink(t, false))}
              {tagsHidden.length > 0 && (
                <div className="folder">
                  <button className="nav-item folder-head" aria-expanded={isOpen("section:hidden-tags", false)} onClick={() => toggleSection("section:hidden-tags", false)}>
                    <span className="nav-icon" aria-hidden>{isOpen("section:hidden-tags", false) ? "▾" : "▸"}</span>
                    <span className="nav-label">Hidden tags</span>
                    <span className="nav-count">{tagsHidden.length}</span>
                  </button>
                  {isOpen("section:hidden-tags", false) && <div className="folder-lists">{tagsHidden.map((t) => tagLink(t, true))}</div>}
                </div>
              )}
            </div>
          )}
        </>
      )}
      <div className="nav-group nav-bottom">
        {BOTTOM_ITEMS.map((s) => link({ kind: "smart", id: s.id }, s.name, s.icon))}
        {link({ kind: "import" }, "Import", "⤓")}
        {link({ kind: "feedback" }, "Feedback", "💬")}
      </div>
      <div className="sync-status">
        <button className="link-btn" onClick={() => void sync()} title="Sync now">{syncLabel}</button>
        <button className="link-btn" onClick={() => void logout()}>Sign out</button>
      </div>
    </nav>
  );
}

function SectionToggle({ open, onToggle, children }: { open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <button className="section-toggle" aria-expanded={open} onClick={onToggle}>
      <span className="caret" aria-hidden>{open ? "▾" : "▸"}</span>
      {children}
    </button>
  );
}
