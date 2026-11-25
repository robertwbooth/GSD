import { useEffect, useState, type FormEvent } from "react";
import { request } from "./store";

interface FeedbackItem {
  id: number;
  kind: "bug" | "idea" | "change";
  text: string;
  createdAt: string;
  issueNumber: number | null;
  issueUrl: string | null;
  status: "filed" | "queued" | "retrying" | "saved";
}

const KINDS = [
  { id: "bug", label: "Something's broken" },
  { id: "idea", label: "New idea" },
  { id: "change", label: "Change something" },
] as const;

const OUTBOX_KEY = "gsd-feedback-outbox";

function queued(): { kind: string; text: string; context: Record<string, string> }[] {
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "[]"); } catch { return []; }
}
function setQueued(items: ReturnType<typeof queued>) {
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(items)); } catch { /* storage unavailable */ }
}

/** Send feedback that was written while offline. */
export async function flushFeedback() {
  const items = queued();
  const left = [];
  for (const item of items) {
    try { await request("/api/feedback", { method: "POST", body: JSON.stringify(item) }); }
    catch { left.push(item); }
  }
  setQueued(left);
}

export function FeedbackForm({ context, onDone }: { context: Record<string, string>; onDone?: (msg: string) => void }) {
  const [kind, setKind] = useState<FeedbackItem["kind"]>("idea");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    const payload = { kind, text: text.trim(), context };
    try {
      const item = await request<FeedbackItem>("/api/feedback", { method: "POST", body: JSON.stringify(payload) });
      onDone?.(item.issueNumber ? `Feedback sent as issue #${item.issueNumber}` : "Feedback saved");
    } catch {
      setQueued([...queued(), payload]);
      onDone?.("You're offline. Feedback will send when you reconnect.");
    }
    setText("");
    setBusy(false);
  }

  return (
    <form className="feedback-form" onSubmit={submit}>
      <div className="segmented" role="radiogroup" aria-label="Feedback type">
        {KINDS.map((k) => (
          <button type="button" key={k.id} role="radio" aria-checked={kind === k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>{k.label}</button>
        ))}
      </div>
      <textarea
        aria-label="Feedback"
        placeholder={kind === "bug" ? "What happened, and what did you expect?" : "What would you like to change or add?"}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        autoFocus
      />
      <button className="primary" disabled={busy || !text.trim()}>{busy ? "Sending…" : "Send feedback"}</button>
    </form>
  );
}

export function FeedbackDialog({ context, onClose, onDone }: { context: Record<string, string>; onClose: () => void; onDone: (msg: string) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Send feedback" onClick={(e) => e.stopPropagation()}>
        <h2>Send feedback</h2>
        <p className="muted">This goes straight to the GSD repo as an issue.</p>
        <FeedbackForm context={context} onDone={(m) => { onDone(m); onClose(); }} />
      </div>
    </div>
  );
}

export function FeedbackPage({ context, onOpenSidebar }: { context: Record<string, string>; onOpenSidebar: () => void }) {
  const [items, setItems] = useState<FeedbackItem[] | null>(null);
  const [configured, setConfigured] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      await flushFeedback();
      const r = await request<{ items: FeedbackItem[]; githubConfigured: boolean }>("/api/feedback");
      setItems(r.items);
      setConfigured(r.githubConfigured);
      setError(null);
    } catch {
      setError("Can't reach the server right now.");
    }
  }
  useEffect(() => { void load(); }, []);

  return (
    <section className="list-pane feedback-page" aria-label="Feedback">
      <header className="list-header">
        <button className="icon-btn menu-btn" aria-label="Open menu" onClick={onOpenSidebar}>☰</button>
        <h1>Feedback</h1>
      </header>
      <div className="task-scroll">
        <FeedbackForm context={context} onDone={() => void load()} />
        {!configured && <p className="notice">GitHub isn't connected on the server yet, so feedback is saved there for now. Set GSD_GITHUB_TOKEN and GSD_GITHUB_REPO to file issues.</p>}
        {error && <p className="notice">{error}</p>}
        <h2 className="section-title">Sent</h2>
        {items?.length === 0 && <p className="empty">No feedback yet.</p>}
        <ul className="feedback-list">
          {items?.map((f) => (
            <li key={f.id}>
              <span className={`badge ${f.kind}`}>{f.kind}</span>
              <span className="feedback-text">{f.text}</span>
              <span className="muted">
                {f.issueUrl ? <a href={f.issueUrl} target="_blank" rel="noreferrer">#{f.issueNumber}</a> : f.status}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
