import { useSyncExternalStore } from "react";
import { getSyncState, getVersion, subscribe } from "./store";

/** Re-render whenever the store changes. */
export function useStoreVersion(): number {
  return useSyncExternalStore(subscribe, getVersion);
}

export function useSyncState() {
  return useSyncExternalStore(subscribe, getSyncState);
}
