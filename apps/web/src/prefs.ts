import { useEffect, useState } from "react";

/** Small per-device settings kept in localStorage, e.g. collapsed sidebar sections and hidden tags. */
const listeners = new Set<() => void>();

function read(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]") as string[]; } catch { return []; }
}

export function getSet(key: string): Set<string> {
  return new Set(read(key));
}

export function toggleInSet(key: string, value: string, on?: boolean) {
  const s = getSet(key);
  if (on ?? !s.has(value)) s.add(value); else s.delete(value);
  try { localStorage.setItem(key, JSON.stringify([...s])); } catch { /* storage unavailable */ }
  for (const l of listeners) l();
}

/** A set from localStorage that re-renders the component when it changes. */
export function usePrefSet(key: string): Set<string> {
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return getSet(key);
}

export const COLLAPSED = "gsd-collapsed-folders";
export const HIDDEN_TAGS = "gsd-hidden-tags";
