import { useEffect, useState } from "react";
import { request, sync as syncNow } from "./store";

interface Status {
  configured: boolean;
  connected: boolean;
  lastSync: string | null;
  lastError: string | null;
  lastResult: { lists: number; created: number; updated: number; completedHere: number; completedThere: number; skippedProjects: string[] } | null;
  redirectUrl: string | null;
}

/** Connect GSD to TickTick and see how the 15-minute sync is going. */
export function TickTickSync() {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => request<Status>("/api/ticktick").then(setStatus).catch((e: Error) => setError(e.message));
  useEffect(() => { void load(); }, []);

  async function connect() {
    setBusy(true);
    setError(null);
    try {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const { url } = await request<{ url: string }>("/api/ticktick/connect", { method: "POST", body: JSON.stringify({ zone }) });
      location.href = url;
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  async function runSync() {
    setBusy(true);
    setError(null);
    try {
      await syncNow(); // send this device's ticks first, so they reach TickTick in this run
      await request("/api/ticktick/sync", { method: "POST" });
      await syncNow();
    } catch (e) {
      setError((e as Error).message);
    }
    await load();
    setBusy(false);
  }

  async function disconnect() {
    if (!confirm("Stop syncing with TickTick? Tasks already here stay.")) return;
    await request("/api/ticktick/disconnect", { method: "POST" });
    await load();
  }

  if (!status) return null;
  const r = status.lastResult;
  return (
    <div className="ticktick-sync" aria-label="TickTick live sync" role="region">
      <h2 className="section-title">TickTick live sync</h2>
      {!status.configured ? (
        <p className="muted">
          Keeps GSD up to date with TickTick every 15 minutes while you move over. To turn it on, register an app at{" "}
          <a href="https://developer.ticktick.com/manage" target="_blank" rel="noreferrer">developer.ticktick.com</a> with the
          redirect URL <code>{location.origin}/api/ticktick/callback</code>, then add its Client ID and Secret to the server's settings.
        </p>
      ) : !status.connected ? (
        <>
          <p>Every 15 minutes GSD brings in new tasks and edits from TickTick, and ticking a task off here completes it in TickTick too.</p>
          <button className="primary" disabled={busy} onClick={() => void connect()}>Connect TickTick</button>
        </>
      ) : (
        <>
          <p>
            Connected. {status.lastSync ? <>Last synced {new Date(status.lastSync).toLocaleString()}.</> : "First sync is running."}
            {r && (
              <span className="muted">
                {" "}{r.created} new, {r.updated} updated, {r.completedHere} completed in TickTick, {r.completedThere} ticked off here and sent over.
              </span>
            )}
          </p>
          {r && r.skippedProjects.length > 0 && <p className="muted">Couldn't read: {r.skippedProjects.join(", ")}.</p>}
          <div className="row-actions">
            <button className="primary" disabled={busy} onClick={() => void runSync()}>{busy ? "Syncing…" : "Sync now"}</button>
            <button className="link-btn" onClick={() => void disconnect()}>Disconnect</button>
          </div>
        </>
      )}
      {(error || status.lastError) && <p className="notice" role="alert">{error ?? status.lastError}</p>}
    </div>
  );
}
