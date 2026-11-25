import { RRule } from "rrule";
import type { Repeat } from "./types.js";

// rrule works in UTC. Represent local wall-clock times as "floating" UTC dates so
// repeats keep the same local time across daylight-saving changes.
function toFloating(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds()));
}
function fromFloating(d: Date): Date {
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds());
}

/**
 * The next due date for a repeating task.
 * `due` is the current due date; `completedAt` is when it was completed.
 */
export function nextOccurrence(repeat: Repeat, due: Date, completedAt: Date): Date | null {
  const opts = RRule.parseString(repeat.rrule);
  let start = due;
  if (repeat.fromCompletion) {
    start = new Date(completedAt);
    start.setHours(due.getHours(), due.getMinutes(), due.getSeconds(), 0);
  }
  const rule = new RRule({ ...opts, dtstart: toFloating(start) });
  const next = rule.after(toFloating(start), false);
  return next ? fromFloating(next) : null;
}

/** Human description of a repeat rule, e.g. "Every week on Monday". */
export function describeRepeat(repeat: Repeat): string {
  try {
    const text = RRule.fromString(repeat.rrule).toText();
    const label = text.charAt(0).toUpperCase() + text.slice(1);
    return repeat.fromCompletion ? `${label} after completion` : label;
  } catch {
    return "Custom repeat";
  }
}
