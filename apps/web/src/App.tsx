import { useEffect, useState } from "react";
import { onUndoChange, undo, allLists } from "./actions";
import { Detail } from "./Detail";
import { FeedbackDialog, FeedbackPage, flushFeedback } from "./Feedback";
import { ImportPage } from "./Import";
import { useStoreVersion } from "./hooks";
import { Login } from "./Login";
import { Sidebar } from "./Sidebar";
import { isSignedIn, startBackgroundSync } from "./store";
import { TaskListView } from "./TaskList";
import { describeView, useView } from "./view";

const isTyping = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

export function App() {
  useStoreVersion();
  return isSignedIn() ? <Shell /> : <Login />;
}

function Shell() {
  const [view] = useView();
  const [selected, setSelected] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [toast, setToast] = useState<{ msg: string; undo: boolean } | null>(null);

  useEffect(() => {
    const stop = startBackgroundSync();
    void flushFeedback();
    return stop;
  }, []);

  useEffect(() => {
    const off = onUndoChange((e) => setToast(e ? { msg: e.label, undo: true } : null));
    return () => { off(); };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => setSelected(null), [view.kind, (view as { id?: string }).id, (view as { tag?: string }).tag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setSelected(null); setSidebarOpen(false); return; }
      if (isTyping(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "n" || e.key === "q") { e.preventDefault(); document.getElementById("quick-add")?.focus(); }
      if (e.key === "f") { e.preventDefault(); setFeedbackOpen(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const context = {
    view: describeView(view, (id) => allLists().find((l) => l.id === id)?.name),
    device: /Android/.test(navigator.userAgent) ? "Android" : /Mac/.test(navigator.userAgent) ? "Mac" : "Browser",
    width: `${window.innerWidth}px`,
    version: import.meta.env.VITE_GSD_VERSION ?? "dev",
  };

  return (
    <div className={`shell${selected ? " has-detail" : ""}${sidebarOpen ? " sidebar-open" : ""}`}>
      <Sidebar view={view} onNavigate={() => setSidebarOpen(false)} />
      <div className="scrim" onClick={() => setSidebarOpen(false)} />
      {view.kind === "feedback" ? (
        <FeedbackPage context={context} onOpenSidebar={() => setSidebarOpen(true)} />
      ) : view.kind === "import" ? (
        <ImportPage onOpenSidebar={() => setSidebarOpen(true)} />
      ) : (
        <TaskListView view={view} selectedId={selected} onSelect={setSelected} onOpenSidebar={() => setSidebarOpen(true)} />
      )}
      {selected && <Detail id={selected} onClose={() => setSelected(null)} onSelect={setSelected} />}
      <button className="feedback-fab" aria-label="Send feedback" title="Send feedback (F)" onClick={() => setFeedbackOpen(true)}>💬</button>
      {feedbackOpen && (
        <FeedbackDialog context={context} onClose={() => setFeedbackOpen(false)} onDone={(msg) => setToast({ msg, undo: false })} />
      )}
      {toast && (
        <div className="toast" role="status">
          <span>{toast.msg}</span>
          {toast.undo && <button className="link-btn" onClick={() => { undo(); setToast(null); }}>Undo</button>}
        </div>
      )}
    </div>
  );
}
