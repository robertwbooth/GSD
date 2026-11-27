import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Link from "@tiptap/extension-link";
import Placeholder from "@tiptap/extension-placeholder";
import Table from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import Image from "@tiptap/extension-image";
import type { Page } from "@gsd/core";
import { allPages, createPage, deletePage, updatePage } from "./actions";
import { openContextMenu } from "./ContextMenu";
import { pageMenu } from "./menus";
import { get } from "./store";

const go = (id: string | null) => {
  location.hash = id ? `#/note/${encodeURIComponent(id)}` : "#/notes";
};

const EXPANDED_KEY = "gsd-expanded-pages";
function loadExpanded(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(EXPANDED_KEY) ?? "[]")); } catch { return new Set(); }
}

export function NotesView({ id, onOpenSidebar }: { id: string | null; onOpenSidebar: () => void }) {
  const pages = allPages();
  const [expanded, setExpanded] = useState(loadExpanded);
  const [filter, setFilter] = useState("");

  const children = useMemo(() => {
    const m = new Map<string | null, Page[]>();
    const ids = new Set(pages.map((p) => p.id));
    for (const p of pages) {
      const key = p.parentId && ids.has(p.parentId) ? p.parentId : null;
      const arr = m.get(key) ?? [];
      arr.push(p);
      m.set(key, arr);
    }
    return m;
  }, [pages]);

  // Open the path to the selected page.
  useEffect(() => {
    if (!id) return;
    let cur = get("page", id)?.parentId ?? null;
    const next = new Set(expanded);
    let changed = false;
    while (cur) {
      if (!next.has(cur)) { next.add(cur); changed = true; }
      cur = get("page", cur)?.parentId ?? null;
    }
    if (changed) setExpanded(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  function toggle(pid: string) {
    const next = new Set(expanded);
    if (next.has(pid)) next.delete(pid); else next.add(pid);
    setExpanded(next);
    try { localStorage.setItem(EXPANDED_KEY, JSON.stringify([...next])); } catch { /* storage unavailable */ }
  }

  function add(parentId: string | null) {
    const pid = createPage(parentId);
    if (parentId) setExpanded(new Set(expanded).add(parentId));
    go(pid);
  }

  const q = filter.trim().toLowerCase();
  const matches = q ? pages.filter((p) => p.title.toLowerCase().includes(q) || p.content.toLowerCase().includes(q)) : null;

  const renderTree = (parent: string | null, depth: number): React.ReactNode =>
    (children.get(parent) ?? []).map((p) => {
      const kids = children.get(p.id) ?? [];
      const open = expanded.has(p.id);
      return (
        <div key={p.id}>
          <div className={`page-row${p.id === id ? " selected" : ""}`} style={{ paddingLeft: 8 + depth * 16 }} onClick={() => go(p.id)} onContextMenu={(e) => openContextMenu(e, pageMenu(p.id, go), p.title || "Untitled")} data-testid="page-row">
            <button className="expander" aria-label={open ? "Collapse" : "Expand"} style={{ visibility: kids.length ? "visible" : "hidden" }} onClick={(e) => { e.stopPropagation(); toggle(p.id); }}>
              {open ? "▾" : "▸"}
            </button>
            <span className="page-icon" aria-hidden>{p.icon ?? "📄"}</span>
            <span className="page-title">{p.title || "Untitled"}</span>
            <button className="icon-btn page-add" aria-label={`Add page inside ${p.title || "Untitled"}`} onClick={(e) => { e.stopPropagation(); add(p.id); }}>+</button>
          </div>
          {open && renderTree(p.id, depth + 1)}
        </div>
      );
    });

  return (
    <>
      <section className="list-pane notes-tree" aria-label="Notes">
        <header className="list-header">
          <button className="icon-btn menu-btn" aria-label="Open menu" onClick={onOpenSidebar}>☰</button>
          <h1>Notes</h1>
          <button className="icon-btn" aria-label="New page" onClick={() => add(null)}>＋</button>
        </header>
        <div className="quick-add">
          <input type="search" placeholder="Search notes" aria-label="Search notes" value={filter} onChange={(e) => setFilter(e.target.value)} />
        </div>
        <div className="task-scroll">
          {pages.length === 0 && <p className="empty">No notes yet. Add a page, or bring your notes over from Import.</p>}
          {matches
            ? matches.map((p) => (
                <div key={p.id} className={`page-row${p.id === id ? " selected" : ""}`} onClick={() => go(p.id)} onContextMenu={(e) => openContextMenu(e, pageMenu(p.id, go), p.title || "Untitled")} data-testid="page-row">
                  <span className="page-icon" aria-hidden>{p.icon ?? "📄"}</span>
                  <span className="page-title">{p.title || "Untitled"}</span>
                </div>
              ))
            : renderTree(null, 0)}
        </div>
      </section>
      {id && <PageEditor key={id} id={id} />}
    </>
  );
}

function PageEditor({ id }: { id: string }) {
  const page = get("page", id);
  const [title, setTitle] = useState(page?.title ?? "");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const titleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder: "Write something. Markdown shortcuts work: # heading, - list, [ ] to-do, > quote" }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Image.configure({ inline: false, allowBase64: true }),
    ],
    content: page?.content ?? "",
    onUpdate: ({ editor: ed }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => updatePage(id, { content: ed.getHTML() }), 600);
    },
    onBlur: ({ editor: ed }) => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (ed.getHTML() !== get("page", id)?.content) updatePage(id, { content: ed.getHTML() });
    },
  });

  // Save pending edits when leaving the page.
  const latestTitle = useRef(title);
  latestTitle.current = title;
  useEffect(() => () => {
    if (saveTimer.current && editor && !editor.isDestroyed) {
      clearTimeout(saveTimer.current);
      updatePage(id, { content: editor.getHTML() });
    }
  }, [editor, id]);
  useEffect(() => () => {
    if (titleTimer.current) {
      clearTimeout(titleTimer.current);
      if (latestTitle.current !== get("page", id)?.title) updatePage(id, { title: latestTitle.current });
    }
  }, [id]);

  // Pick up a title changed elsewhere (another device, or Rename in the right-click menu).
  useEffect(() => {
    if (page && page.title !== title && !titleTimer.current && document.activeElement?.className !== "note-title") setTitle(page.title);
  }, [page?.title]); // eslint-disable-line react-hooks/exhaustive-deps

  // Show edits synced from another device when this one isn't typing.
  useEffect(() => {
    if (editor && page && !editor.isFocused && page.content !== editor.getHTML()) {
      editor.commands.setContent(page.content, false);
    }
  }, [editor, page?.content]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!page || page.deleted) return <aside className="detail note-editor"><p className="muted">This page was deleted.</p></aside>;

  const crumbs: Page[] = [];
  let cur = page.parentId ? get("page", page.parentId) : undefined;
  while (cur) {
    crumbs.unshift(cur);
    cur = cur.parentId ? get("page", cur.parentId) : undefined;
  }
  const backlinks = allPages().filter((p) => p.id !== id && p.content.includes(`#/note/${id}`));

  function onClick(e: MouseEvent) {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    const href = a.getAttribute("href") ?? "";
    e.preventDefault();
    if (href.startsWith("#/")) location.hash = href;
    else if (href) window.open(href, "_blank", "noopener");
  }

  return (
    <aside className="detail note-editor" aria-label="Page">
      <div className="note-top">
        <button className="icon-btn back-btn" aria-label="Back to notes" onClick={() => go(null)}>←</button>
        <nav className="crumbs" aria-label="Breadcrumb">
          {crumbs.map((c) => (
            <a key={c.id} href={`#/note/${c.id}`}>{c.icon ? `${c.icon} ` : ""}{c.title || "Untitled"}</a>
          ))}
        </nav>
        <span className="spacer" />
        <button className="link-btn danger" onClick={() => { if (confirm(`Delete "${page.title || "Untitled"}" and the pages inside it?`)) { deletePage(id); go(page.parentId); } }}>Delete</button>
      </div>
      <div className="note-head">
        <button className="note-icon" aria-label="Change icon" onClick={() => { const v = prompt("Emoji for this page (leave empty to remove)", page.icon ?? ""); if (v !== null) updatePage(id, { icon: v.trim() || null }); }}>
          {page.icon ?? "📄"}
        </button>
        <input
          className="note-title"
          aria-label="Page title"
          placeholder="Untitled"
          value={title}
          autoFocus={!page.title}
          onChange={(e) => {
            const v = e.target.value;
            setTitle(v);
            if (titleTimer.current) clearTimeout(titleTimer.current);
            titleTimer.current = setTimeout(() => { titleTimer.current = null; updatePage(id, { title: v }); }, 500);
          }}
          onBlur={() => {
            if (titleTimer.current) { clearTimeout(titleTimer.current); titleTimer.current = null; }
            if (title !== page.title) updatePage(id, { title });
          }}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); editor?.commands.focus("start"); } }}
        />
      </div>
      {editor && <Toolbar editor={editor} pageId={id} />}
      <div className="note-body" onClick={onClick}>
        <EditorContent editor={editor} />
      </div>
      {backlinks.length > 0 && (
        <div className="backlinks">
          <h2 className="section-title">Linked from</h2>
          {backlinks.map((b) => <a key={b.id} href={`#/note/${b.id}`}>{b.icon ?? "📄"} {b.title || "Untitled"}</a>)}
        </div>
      )}
    </aside>
  );
}

function Toolbar({ editor, pageId }: { editor: Editor; pageId: string }) {
  const btn = (label: string, active: boolean, run: () => void, text: string) => (
    <button type="button" aria-label={label} title={label} aria-pressed={active} onMouseDown={(e) => e.preventDefault()} onClick={run}>{text}</button>
  );
  return (
    <div className="note-toolbar" role="toolbar" aria-label="Formatting">
      {btn("Heading 1", editor.isActive("heading", { level: 1 }), () => editor.chain().focus().toggleHeading({ level: 1 }).run(), "H1")}
      {btn("Heading 2", editor.isActive("heading", { level: 2 }), () => editor.chain().focus().toggleHeading({ level: 2 }).run(), "H2")}
      {btn("Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), "B")}
      {btn("Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), "I")}
      {btn("Bullet list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), "•")}
      {btn("Numbered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), "1.")}
      {btn("To-do list", editor.isActive("taskList"), () => editor.chain().focus().toggleTaskList().run(), "☑")}
      {btn("Quote", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), "❝")}
      {btn("Code block", editor.isActive("codeBlock"), () => editor.chain().focus().toggleCodeBlock().run(), "</>")}
      {btn("Table", editor.isActive("table"), () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), "▦")}
      {btn("Link", editor.isActive("link"), () => {
        const url = prompt("Link address", editor.getAttributes("link").href ?? "https://");
        if (url === null) return;
        if (!url) editor.chain().focus().unsetLink().run();
        else editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
      }, "🔗")}
      {btn("Link to a page", false, () => {
        const name = prompt("Link to which page? Type part of its title");
        if (!name) return;
        const target = allPages().find((p) => p.id !== pageId && p.title.toLowerCase().includes(name.toLowerCase()));
        if (!target) { alert("No page with that title."); return; }
        editor.chain().focus().insertContent(`<a href="#/note/${target.id}">${(target.icon ?? "") + " " + (target.title || "Untitled")}</a> `).run();
      }, "📄")}
      {btn("Sub-page", false, () => {
        const sub = createPage(pageId);
        editor.chain().focus().insertContent(`<p><a href="#/note/${sub}">📄 New page</a></p>`).run();
        go(sub);
      }, "＋📄")}
    </div>
  );
}
