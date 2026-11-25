import { useState } from "react";
import { importTickTick, isTickTickBackup, type TickTickImport } from "@gsd/core";
import * as store from "./store";

type Stage =
  | { step: "pick" }
  | { step: "preview"; data: TickTickImport; fileName: string }
  | { step: "importing" }
  | { step: "done"; added: number; skipped: number; notes: number }
  | { step: "error"; message: string };

export function ImportPage({ onOpenSidebar }: { onOpenSidebar: () => void }) {
  const [stage, setStage] = useState<Stage>({ step: "pick" });
  const [includeHistory, setIncludeHistory] = useState(true);

  async function pick(file: File | undefined) {
    if (!file) return;
    if (/\.zip$/i.test(file.name)) {
      setStage({ step: "error", message: "That looks like a Notion export. Notion pages import into Notes, which is coming next." });
      return;
    }
    const text = await file.text();
    if (!isTickTickBackup(text)) {
      setStage({ step: "error", message: "This file doesn't look like a TickTick backup. In TickTick, go to Settings → Account → Generate Backup, and choose that CSV." });
      return;
    }
    try {
      setStage({ step: "preview", data: importTickTick(text), fileName: file.name });
    } catch (e) {
      setStage({ step: "error", message: (e as Error).message });
    }
  }

  async function run(data: TickTickImport) {
    setStage({ step: "importing" });
    // Pull first, so a device that hasn't synced yet doesn't re-add tasks edited elsewhere.
    await store.sync();
    // Only add records that aren't already here, so importing again never overwrites edits.
    const has = (type: "folder" | "list" | "section" | "task", id: string) => !!store.get(type, id);
    const tasks = data.tasks.filter((t) => includeHistory || t.status === "open");
    const keep = new Set(tasks.map((t) => t.id));
    for (const t of tasks) if (t.parentId && !keep.has(t.parentId)) t.parentId = null;
    const edits = [
      ...data.folders.filter((f) => !has("folder", f.id)).map((f) => ({ type: "folder" as const, id: f.id, fields: f })),
      ...data.lists.filter((l) => !has("list", l.id)).map((l) => ({ type: "list" as const, id: l.id, fields: l })),
      ...data.sections.filter((s) => !has("section", s.id)).map((s) => ({ type: "section" as const, id: s.id, fields: s })),
      ...tasks.filter((t) => !has("task", t.id)).map((t) => ({ type: "task" as const, id: t.id, fields: t })),
    ];
    const newTasks = edits.filter((e) => e.type === "task").length;
    await store.saveMany(edits);
    setStage({ step: "done", added: newTasks, skipped: tasks.length - newTasks, notes: data.notes.length });
  }

  return (
    <section className="list-pane import-page" aria-label="Import">
      <header className="list-header">
        <button className="icon-btn menu-btn" aria-label="Open menu" onClick={onOpenSidebar}>☰</button>
        <h1>Import</h1>
      </header>
      <div className="task-scroll import-body">
        {(stage.step === "pick" || stage.step === "error") && (
          <>
            <p>Bring your tasks over from TickTick. In TickTick, open <b>Settings → Account → Generate Backup</b>, then choose the CSV file here.</p>
            <label className="file-pick">
              <input type="file" accept=".csv,.zip,text/csv" aria-label="Choose backup file" onChange={(e) => void pick(e.target.files?.[0])} />
            </label>
            {stage.step === "error" && <p className="notice" role="alert">{stage.message}</p>}
          </>
        )}

        {stage.step === "preview" && (
          <>
            <h2 className="section-title">Ready to import {stage.fileName}</h2>
            <ul className="import-summary">
              <li><b>{stage.data.lists.length}</b> lists in <b>{stage.data.folders.length}</b> folders, plus your Inbox</li>
              <li><b>{stage.data.stats.open}</b> open tasks</li>
              <li><b>{stage.data.stats.completed + stage.data.stats.wontdo}</b> completed and won't-do tasks</li>
              <li><b>{stage.data.stats.subtasks}</b> subtasks and <b>{stage.data.stats.checklistItems}</b> checklist items</li>
              <li><b>{stage.data.stats.repeating}</b> repeating tasks, <b>{stage.data.sections.length}</b> board columns</li>
              {stage.data.notes.length > 0 && <li><b>{stage.data.notes.length}</b> notes will import with Notes, which is coming next</li>}
            </ul>
            {stage.data.warnings.map((w) => <p key={w} className="notice">{w}</p>)}
            <label className="field inline">
              <input type="checkbox" checked={includeHistory} onChange={(e) => setIncludeHistory(e.target.checked)} />
              <span>Include completed and won't-do tasks</span>
            </label>
            <div className="import-actions">
              <button className="primary" onClick={() => void run(stage.data)}>Import</button>
              <button className="link-btn" onClick={() => setStage({ step: "pick" })}>Cancel</button>
            </div>
          </>
        )}

        {stage.step === "importing" && <p className="empty">Importing…</p>}

        {stage.step === "done" && (
          <div role="status">
            <h2 className="section-title">Import finished</h2>
            <p>Added <b>{stage.added}</b> tasks.{stage.skipped > 0 && <> Skipped <b>{stage.skipped}</b> that were already here.</>}</p>
            <p className="muted">They'll sync to your other devices in the next few seconds.</p>
            <a href="#/today" className="primary as-link">Go to Today</a>
          </div>
        )}
      </div>
    </section>
  );
}
