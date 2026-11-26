import { describe, expect, it } from "vitest";
import { importNotion, splitIcon, tickTickNotesToPages } from "../src/import/notes.js";
import type { Page } from "../src/types.js";

const A = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const C = "cccccccccccccccccccccccccccccccc";
const D = "dddddddddddddddddddddddddddddddd";

const files = new Map<string, string | Uint8Array>([
  [`Export-123/Trips ${A}.md`, `# 🧳Trips\n\nSee [Japan](Trips/Japan%20${B}.md) and [web](https://example.com).\n\n![map](Trips/map.png)`],
  [`Export-123/Trips/Japan ${B}.md`, `# Japan\n\n- [ ] Book flights\n- Pack **light**`],
  [`Export-123/Trips/map.png`, new Uint8Array([137, 80, 78, 71])],
  [`Export-123/Packing ${C}.md`, `# Packing\n\n[Packing](Packing%20${C}_all.csv)\n\nsort:\nPriority: ascending`],
  [`Export-123/Packing ${C}_all.csv`, `﻿Item,Packed\nPassport,No\n"Socks, wool",Yes\n`],
  [`Export-123/Packing/Passport ${D}.md`, `# Passport\n\nPacked: No\nNotes: Keep safe\n\nCheck expiry date.`],
]);

describe("splitIcon", () => {
  it("separates a leading emoji", () => {
    expect(splitIcon("🚴Cycling")).toEqual({ icon: "🚴", title: "Cycling" });
    expect(splitIcon("🇨🇦 Canada")).toEqual({ icon: "🇨🇦", title: "Canada" });
    expect(splitIcon("Plain")).toEqual({ icon: null, title: "Plain" });
  });
});

describe("importNotion", () => {
  const { pages } = importNotion(files, "2026-11-25T00:00:00.000Z");
  const byTitle = (t: string) => pages.find((p) => p.title === t)!;

  it("builds the page tree from folders", () => {
    expect(pages).toHaveLength(4);
    expect(byTitle("Trips")).toMatchObject({ icon: "🧳", parentId: null, id: `notion-${A}` });
    expect(byTitle("Japan").parentId).toBe(`notion-${A}`);
    expect(byTitle("Passport").parentId).toBe(`notion-${C}`);
  });

  it("converts markdown, rewrites page links and inlines images", () => {
    const trips = byTitle("Trips").content;
    expect(trips).toContain(`href="#/note/notion-${B}"`);
    expect(trips).toContain('href="https://example.com"');
    expect(trips).toContain('src="data:image/png;base64,iVBORw=="');
    expect(byTitle("Japan").content).toContain("<strong>light</strong>");
  });

  it("turns databases into tables linked to their row pages", () => {
    const db = byTitle("Packing").content;
    expect(db).toContain("<th>Item</th>");
    expect(db).toContain(`<a href="#/note/notion-${D}">Passport</a>`);
    expect(db).toContain("Socks, wool");
    expect(db).not.toContain("sort:");
    const row = byTitle("Passport").content;
    expect(row).toContain("<th>Notes</th><td>Keep safe</td>");
    expect(row).toContain("Check expiry date.");
  });

  it("rejects exports without pages", () => {
    expect(() => importNotion(new Map([["x.txt", "hi"]]))).toThrow(/No Notion pages/);
  });
});

describe("tickTickNotesToPages", () => {
  it("groups notes under a page per list", () => {
    const pages = tickTickNotesToPages([
      { sourceId: "ticktick:1", title: "Flying", content: "**Up** high", listName: "😴Dreams", folderName: "", tags: ["lucid"], createdAt: "2026-01-01T00:00:00.000Z" },
      { sourceId: "ticktick:2", title: "Falling", content: "", listName: "😴Dreams", folderName: "", tags: [], createdAt: "2026-01-02T00:00:00.000Z" },
    ]);
    expect(pages).toHaveLength(4);
    const [root, parent, flying] = pages as [Page, Page, Page];
    expect(root).toMatchObject({ title: "From TickTick", parentId: null });
    expect(parent).toMatchObject({ title: "Dreams", icon: "😴", parentId: root.id });
    expect(flying).toMatchObject({ id: "ttn-1", title: "Flying", parentId: parent.id });
    expect(flying.content).toContain("#lucid");
    expect(flying.content).toContain("<strong>Up</strong>");
    expect(tickTickNotesToPages([])).toEqual([]);
  });
});
