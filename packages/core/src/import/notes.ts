import { marked } from "marked";
import type { Page } from "../types.js";
import { parseCsv } from "./csv.js";
import { stableHash, type TickTickNote } from "./ticktick.js";

/** "🚴Cycling" → { icon: "🚴", title: "Cycling" }. */
const LEADING_EMOJI =
  /^((?:\p{Extended_Pictographic}|\p{Regional_Indicator})(?:️|‍(?:\p{Extended_Pictographic}|♂|♀)|\p{Regional_Indicator}|[\u{1F3FB}-\u{1F3FF}])*️?)\s*(.+)$/u;
export function splitIcon(name: string): { icon: string | null; title: string } {
  const m = name.trim().match(LEADING_EMOJI);
  return m ? { icon: m[1]!, title: m[2]!.trim() } : { icon: null, title: name.trim() };
}

export function markdownToHtml(md: string): string {
  return marked.parse(md, { async: false, gfm: true, breaks: true }) as string;
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(fields: Partial<Page> & { id: string; title: string }, now: string): Page {
  return {
    icon: null,
    parentId: null,
    content: "",
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
    deleted: false,
    sourceId: null,
    ...fields,
  };
}

/** TickTick notes become pages, grouped under one page per TickTick list. */
export function tickTickNotesToPages(notes: TickTickNote[], now = new Date().toISOString()): Page[] {
  const parents = new Map<string, Page>();
  const out: Page[] = [];
  notes.forEach((n, i) => {
    const listKey = n.listName || "TickTick notes";
    const parentId = `ttnl-${stableHash(`${n.folderName}\u0000${listKey}`)}`;
    if (!parents.has(parentId)) {
      const { icon, title } = splitIcon(listKey);
      parents.set(parentId, page({ id: parentId, title, icon, sortOrder: parents.size, sourceId: `ticktick-list:${listKey}` }, now));
    }
    const tags = n.tags.length ? `<p>${n.tags.map((t) => `#${escapeHtml(t)}`).join(" ")}</p>` : "";
    out.push(
      page(
        {
          id: `ttn-${n.sourceId.replace(/^ticktick:/, "")}`,
          title: n.title,
          parentId,
          content: tags + markdownToHtml(n.content),
          sortOrder: i,
          createdAt: n.createdAt,
          updatedAt: n.createdAt,
          sourceId: n.sourceId,
        },
        now,
      ),
    );
  });
  if (!out.length) return [];
  const root = page({ id: "ttn-root", title: "From TickTick", icon: "📥", sortOrder: -1, sourceId: "ticktick:notes" }, now);
  for (const p of parents.values()) p.parentId = root.id;
  return [root, ...parents.values(), ...out];
}

// --- Notion ------------------------------------------------------------------

export interface NotionImport {
  pages: Page[];
  warnings: string[];
}

const NOTION_ID = /\s([0-9a-f]{32})(?:_all)?(?=\.(?:md|csv)$)/i;
const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml" };

function dirname(p: string) {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
function basename(p: string) {
  return p.slice(p.lastIndexOf("/") + 1);
}
function joinPath(dir: string, rel: string): string {
  const parts = (dir ? dir.split("/") : []).concat(rel.split("/"));
  const out: string[] = [];
  for (const part of parts) {
    if (part === "..") out.pop();
    else if (part && part !== ".") out.push(part);
  }
  return out.join("/");
}
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Convert an unzipped Notion export ("Markdown & CSV", subpages included) into pages.
 * `files` maps each path inside the zip to its contents (text for .md/.csv, bytes for images).
 */
export function importNotion(files: Map<string, string | Uint8Array>, now = new Date().toISOString()): NotionImport {
  const warnings: string[] = [];
  // Strip the export's top folder ("Export-<uuid>/") when every file shares it.
  const paths = [...files.keys()].filter((p) => !p.endsWith("/") && !p.startsWith("__MACOSX"));
  const first = paths[0]?.split("/")[0] ?? "";
  const strip = first && paths.every((p) => p.startsWith(first + "/")) && /^Export-/i.test(first) ? first.length + 1 : 0;
  const file = new Map<string, string | Uint8Array>();
  for (const p of paths) file.set(p.slice(strip), files.get(p)!);

  const text = (p: string) => {
    const v = file.get(p);
    return typeof v === "string" ? v : v ? new TextDecoder().decode(v) : "";
  };

  const mdPaths = [...file.keys()].filter((p) => p.endsWith(".md"));
  const idFor = (p: string) => {
    const m = basename(p).match(NOTION_ID);
    return `notion-${m ? m[1]!.toLowerCase() : stableHash(p)}`;
  };
  // A page's children live in a folder named like the page file without ".md".
  const pageByFolder = new Map<string, string>();
  for (const p of mdPaths) pageByFolder.set(p.replace(/\.md$/, ""), idFor(p));
  // Folders are named without the id, e.g. "Packing List/" next to "Packing List <id>.md".
  for (const p of mdPaths) pageByFolder.set(joinPath(dirname(p), basename(p).replace(NOTION_ID, "").replace(/\.md$/, "")), idFor(p));

  const titleOf = new Map<string, string>();
  for (const p of mdPaths) {
    const h = text(p).match(/^#\s+(.+)$/m);
    titleOf.set(idFor(p), (h?.[1] ?? basename(p).replace(NOTION_ID, "").replace(/\.md$/, "")).trim());
  }

  const linkFor = (fromDir: string, href: string): string | null => {
    if (/^[a-z]+:/i.test(href) || href.startsWith("#")) return null;
    const target = joinPath(fromDir, decodeURIComponent(href));
    if (target.endsWith(".md") && file.has(target)) return `#/note/${idFor(target)}`;
    return null;
  };

  function csvTable(csvPath: string, fromDir: string): string {
    const rows = parseCsv(text(csvPath)).filter((r) => r.some((c) => c.trim()));
    if (!rows.length) return "";
    const [head, ...body] = rows as [string[], ...string[][]];
    // Row pages sit in the database's folder; link each row title to its page.
    const dbFolder = joinPath(dirname(csvPath), basename(csvPath).replace(NOTION_ID, "").replace(/\.csv$/, ""));
    const rowPages = new Map<string, string>();
    for (const p of mdPaths) if (dirname(p) === dbFolder) rowPages.set(titleOf.get(idFor(p)) ?? "", idFor(p));
    const cell = (c: string, i: number) => {
      const id = i === 0 ? rowPages.get(c.trim()) : undefined;
      return id ? `<a href="#/note/${id}">${escapeHtml(c)}</a>` : escapeHtml(c);
    };
    void fromDir;
    return (
      `<table><tbody><tr>${head.map((h) => `<th>${escapeHtml(h)}</th>`).join("")}</tr>` +
      body.map((r) => `<tr>${head.map((_, i) => `<td>${cell(r[i] ?? "", i)}</td>`).join("")}</tr>`).join("") +
      `</tbody></table>`
    );
  }

  const pages: Page[] = [];
  mdPaths.sort().forEach((p, i) => {
    const id = idFor(p);
    const dir = dirname(p);
    let md = text(p).replace(/\r\n?/g, "\n");
    md = md.replace(/^#\s+.+\n?/, ""); // title line

    // Database pages: replace the CSV link (and Notion's view settings) with the table.
    const csvLink = md.match(/\[[^\]]*\]\(([^)]+_all\.csv)\)/);
    let tableHtml = "";
    if (csvLink) {
      const csvPath = joinPath(dir, decodeURIComponent(csvLink[1]!));
      tableHtml = file.has(csvPath) ? csvTable(csvPath, dir) : "";
      md = md.slice(0, csvLink.index);
    }

    // Rows of a database start with "Key: value" lines; show them as a small table.
    let propsHtml = "";
    const parentFolderIsDb = [...file.keys()].some((f) => f.endsWith("_all.csv") && joinPath(dirname(f), basename(f).replace(NOTION_ID, "").replace(/\.csv$/, "")) === dir);
    if (parentFolderIsDb) {
      const lines = md.replace(/^\n+/, "").split("\n");
      const props: [string, string][] = [];
      while (lines.length && /^[^:\n]{1,60}:\s/.test(lines[0]!)) {
        const [k, ...v] = lines.shift()!.split(":");
        props.push([k!.trim(), v.join(":").trim()]);
      }
      if (props.length) {
        propsHtml = `<table><tbody>${props.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}</tbody></table>`;
        md = lines.join("\n");
      }
    }

    // Rewrite links to other pages and inline images.
    md = md.replace(/(!?)\[([^\]]*)\]\(([^)\s]+)\)/g, (whole, bang: string, label: string, href: string) => {
      if (bang) {
        const imgPath = joinPath(dir, decodeURIComponent(href));
        const data = file.get(imgPath);
        if (data instanceof Uint8Array && IMAGE.test(imgPath)) {
          if (data.length > 2_000_000) {
            warnings.push(`Skipped a large image in "${titleOf.get(id)}".`);
            return `*(image: ${label || basename(imgPath)})*`;
          }
          const ext = imgPath.split(".").pop()!.toLowerCase();
          return `![${label}](data:${MIME[ext]};base64,${toBase64(data)})`;
        }
        return whole;
      }
      const link = linkFor(dir, href);
      return link ? `[${label}](${link})` : whole;
    });

    const fullTitle = titleOf.get(id) ?? "Untitled";
    const { icon, title } = splitIcon(fullTitle);
    pages.push({
      id,
      title: title || "Untitled",
      icon,
      parentId: pageByFolder.get(dir) ?? null,
      content: propsHtml + markdownToHtml(md.trim()) + tableHtml,
      sortOrder: i,
      createdAt: now,
      updatedAt: now,
      deleted: false,
      sourceId: `notion:${id.replace(/^notion-/, "")}`,
    });
  });

  if (!pages.length) throw new Error("No Notion pages found. Export with the Markdown & CSV format and include subpages.");
  return { pages, warnings };
}
