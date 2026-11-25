/** Sortable, collision-resistant id (time prefix + random suffix). */
export function newId(): string {
  const t = Date.now().toString(36).padStart(9, "0");
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => (b % 36).toString(36)).join("");
  return `${t}${r}`;
}
