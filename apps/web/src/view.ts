import { useEffect, useState } from "react";

export type View =
  | { kind: "smart"; id: "today" | "tomorrow" | "next7" | "inbox" | "all" | "completed" | "wontdo" | "trash" }
  | { kind: "list"; id: string }
  | { kind: "tag"; tag: string }
  | { kind: "search"; q: string }
  | { kind: "feedback" }
  | { kind: "import" }
  | { kind: "notes"; id: string | null };

const SMART = new Set(["today", "tomorrow", "next7", "inbox", "all", "completed", "wontdo", "trash"]);

export function parseHash(hash: string): View {
  const parts = hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const [a, b] = parts;
  if (a === "list" && b) return { kind: "list", id: b };
  if (a === "tag" && b) return { kind: "tag", tag: parts.slice(1).join("/") };
  if (a === "search") return { kind: "search", q: b ?? "" };
  if (a === "feedback") return { kind: "feedback" };
  if (a === "import") return { kind: "import" };
  if (a === "notes") return { kind: "notes", id: null };
  if (a === "note" && b) return { kind: "notes", id: b };
  if (a && SMART.has(a)) return { kind: "smart", id: a as never };
  return { kind: "smart", id: "today" };
}

export function viewHash(v: View): string {
  switch (v.kind) {
    case "smart": return `#/${v.id}`;
    case "list": return `#/list/${encodeURIComponent(v.id)}`;
    case "tag": return `#/tag/${v.tag.split("/").map(encodeURIComponent).join("/")}`;
    case "search": return `#/search/${encodeURIComponent(v.q)}`;
    case "feedback": return "#/feedback";
    case "import": return "#/import";
    case "notes": return v.id ? `#/note/${encodeURIComponent(v.id)}` : "#/notes";
  }
}

export function useView(): [View, (v: View) => void] {
  const [view, setView] = useState(() => parseHash(location.hash));
  useEffect(() => {
    const on = () => setView(parseHash(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return [view, (v) => { location.hash = viewHash(v); }];
}

export function describeView(v: View, listName: (id: string) => string | undefined): string {
  switch (v.kind) {
    case "smart":
      return { today: "Today", tomorrow: "Tomorrow", next7: "Next 7 Days", inbox: "Inbox", all: "All", completed: "Completed", wontdo: "Won't Do", trash: "Trash" }[v.id];
    case "list": return listName(v.id) ?? "List";
    case "tag": return `#${v.tag}`;
    case "search": return `Search: ${v.q}`;
    case "feedback": return "Feedback";
    case "import": return "Import";
    case "notes": return "Notes";
  }
}
