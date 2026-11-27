import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

/** One row of a right-click menu. A "sep" draws a divider. Items with `items` open a submenu. */
export type MenuItem =
  | "sep"
  | { label: string; icon?: string; onClick?: () => void; danger?: boolean; checked?: boolean; items?: MenuItem[] };

interface OpenMenu {
  x: number;
  y: number;
  items: MenuItem[];
  title?: string;
}

let current: OpenMenu | null = null;
const listeners = new Set<(m: OpenMenu | null) => void>();
function set(m: OpenMenu | null) {
  current = m;
  for (const l of listeners) l(m);
}

/** Show a menu at the pointer. Use as an onContextMenu handler; long-press on Android fires it too. */
export function openContextMenu(e: ReactMouseEvent | MouseEvent, items: MenuItem[], title?: string) {
  e.preventDefault();
  e.stopPropagation();
  set({ x: e.clientX, y: e.clientY, items, title });
}

/** Show a menu under a button, for the "⋯" buttons that do the same thing as right-click. */
export function openMenuAt(el: HTMLElement, items: MenuItem[], title?: string) {
  const r = el.getBoundingClientRect();
  set({ x: r.left, y: r.bottom + 4, items, title });
}

export function closeContextMenu() {
  set(null);
}

export function ContextMenuHost() {
  const [menu, setMenu] = useState<OpenMenu | null>(current);
  useEffect(() => {
    listeners.add(setMenu);
    return () => { listeners.delete(setMenu); };
  }, []);
  useEffect(() => {
    if (!menu) return;
    const close = () => set(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); close(); } };
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [menu]);
  if (!menu) return null;
  return (
    <div className="ctx-layer" onMouseDown={() => set(null)} onContextMenu={(e) => { e.preventDefault(); set(null); }}>
      <MenuPanel key={`${menu.x},${menu.y}`} x={menu.x} y={menu.y} items={menu.items} title={menu.title} autoFocus />
    </div>
  );
}

function MenuPanel({ x, y, items, title, autoFocus, onBack }: { x: number; y: number; items: MenuItem[]; title?: string; autoFocus?: boolean; onBack?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [sub, setSub] = useState<{ items: MenuItem[]; title: string; x: number; y: number } | null>(null);

  // Keep the menu on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const pad = 8;
    setPos({
      left: Math.max(pad, Math.min(x, window.innerWidth - r.width - pad)),
      top: Math.max(pad, Math.min(y, window.innerHeight - r.height - pad)),
    });
    if (autoFocus) el.querySelector<HTMLButtonElement>("button[role^=menuitem]")?.focus();
  }, [x, y, autoFocus]);

  function onKeyDown(e: React.KeyboardEvent) {
    const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>(":scope > button[role^=menuitem]") ?? [])];
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    if (e.key === "ArrowLeft" && onBack) { e.preventDefault(); onBack(); }
  }

  return (
    <>
      <div
        ref={ref}
        className="ctx-menu"
        role="menu"
        aria-label={title ?? "Actions"}
        style={{ left: pos.left, top: pos.top }}
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        {title && <div className="ctx-title">{title}</div>}
        {items.map((it, i) =>
          it === "sep" ? (
            <div key={i} className="ctx-sep" role="separator" />
          ) : (
            <button
              key={i}
              role={it.checked === undefined ? "menuitem" : "menuitemcheckbox"}
              aria-checked={it.checked}
              aria-haspopup={it.items ? "menu" : undefined}
              className={`${it.danger ? "danger" : ""}${sub?.title === it.label ? " open" : ""}`}
              onMouseEnter={(e) => {
                if (it.items) { const r = e.currentTarget.getBoundingClientRect(); setSub({ items: it.items, title: it.label, x: r.right - 4, y: r.top - 4 }); }
                else setSub(null);
              }}
              onKeyDown={(e) => {
                if (it.items && (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ")) {
                  e.preventDefault();
                  const r = e.currentTarget.getBoundingClientRect();
                  setSub({ items: it.items, title: it.label, x: r.right - 4, y: r.top - 4 });
                }
              }}
              onClick={(e) => {
                if (it.items) { const r = e.currentTarget.getBoundingClientRect(); setSub({ items: it.items, title: it.label, x: r.right - 4, y: r.top - 4 }); return; }
                set(null);
                it.onClick?.();
              }}
            >
              <span className="ctx-icon" aria-hidden>{it.checked ? "✓" : it.icon ?? ""}</span>
              <span className="ctx-label">{it.label}</span>
              {it.items && <span className="ctx-more" aria-hidden>›</span>}
            </button>
          ),
        )}
      </div>
      {sub && <MenuPanel key={sub.title} x={sub.x} y={sub.y} items={sub.items} title={sub.title} autoFocus onBack={() => setSub(null)} />}
    </>
  );
}
