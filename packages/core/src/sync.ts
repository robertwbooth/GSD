import type { EntityType } from "./types.js";

/**
 * Sync model: every entity is stored as a record whose fields each carry a clock.
 * Merging takes, per field, the value with the larger clock (last writer wins per field),
 * so edits to different fields on different devices never overwrite each other.
 *
 * A clock is "<13-digit ms>:<4-digit counter>:<device id>" and compares as a string.
 */
export type Clock = string;

export interface SyncRecord<T = Record<string, unknown>> {
  id: string;
  type: EntityType;
  data: T;
  clocks: Record<string, Clock>;
}

export class HybridClock {
  private last = 0;
  private counter = 0;
  constructor(public readonly device: string, private now: () => number = Date.now) {}

  tick(): Clock {
    const t = this.now();
    if (t > this.last) {
      this.last = t;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return HybridClock.format(this.last, this.counter, this.device);
  }

  /** Advance past a clock seen from another device so local edits always sort after it. */
  observe(clock: Clock): void {
    const [ms, counter] = HybridClock.parse(clock);
    if (ms > this.last || (ms === this.last && counter > this.counter)) {
      this.last = ms;
      this.counter = counter;
    }
  }

  static format(ms: number, counter: number, device: string): Clock {
    return `${String(ms).padStart(13, "0")}:${String(counter).padStart(4, "0")}:${device}`;
  }

  static parse(clock: Clock): [number, number, string] {
    const [ms, counter, ...device] = clock.split(":");
    return [Number(ms), Number(counter), device.join(":")];
  }
}

/** A local edit: the changed fields of one entity, all stamped with one clock. */
export function makeChange<T extends object>(
  type: EntityType,
  id: string,
  fields: Partial<T>,
  clock: Clock,
): SyncRecord<Partial<T>> {
  const clocks: Record<string, Clock> = {};
  for (const k of Object.keys(fields)) clocks[k] = clock;
  return { id, type, data: { ...fields }, clocks };
}

/** Merge `incoming` into `base` field by field. Returns the merged record and whether anything changed. */
export function mergeRecord(
  base: SyncRecord | undefined,
  incoming: SyncRecord,
): { record: SyncRecord; changed: boolean } {
  if (!base) {
    return {
      record: { id: incoming.id, type: incoming.type, data: { ...incoming.data }, clocks: { ...incoming.clocks } },
      changed: true,
    };
  }
  const data = { ...base.data };
  const clocks = { ...base.clocks };
  let changed = false;
  for (const [field, clock] of Object.entries(incoming.clocks)) {
    const cur = clocks[field];
    if (cur === undefined || clock > cur) {
      data[field] = (incoming.data as Record<string, unknown>)[field];
      clocks[field] = clock;
      changed = true;
    }
  }
  return { record: { id: base.id, type: base.type, data, clocks }, changed };
}

export interface PushRequest {
  changes: SyncRecord[];
}
export interface PullResponse {
  records: SyncRecord[];
  /** Pass back as `since` on the next pull. */
  cursor: number;
}
