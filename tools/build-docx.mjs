/**
 * Builds the submission document as a Word file.
 *
 * Renders every Mermaid block to PNG, merges the High Level Design with the
 * Decision Log and the diagram set, and writes the Office Open XML package
 * directly. Cross-references become bookmark links inside the document and
 * every diagram is embedded, so the file carries no dependency on the machine
 * that produced it.
 *
 *   node tools/build-docx.mjs
 *
 * Output: build/NeoBank-HLD-<author>.docx
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";
import {
  AlignmentType, BorderStyle, Bookmark, Document, ExternalHyperlink, HeadingLevel,
  ImageRun, InternalHyperlink, LevelFormat, Packer, PageBreak, Paragraph, ShadingType,
  Table, TableCell, TableRow, TextRun, WidthType,
} from "docx";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const WORK = join(BUILD, "diagrams");
const AUTHOR = "Sunny Dubey";
const TITLE = "NeoBank Digital Leap — High Level Design";
const OUT = join(BUILD, `NeoBank-HLD-${AUTHOR.replace(/\s+/g, "-")}.docx`);

const SOURCES = {
  hld: join(ROOT, "docs", "solution", "hld.md"),
  decisions: join(ROOT, "docs", "solution", "decisions.md"),
  diagrams: join(ROOT, "docs", "solution", "diagrams.md"),
};

// A4 with 2 cm margins leaves 17 cm of usable width.
const PAGE_WIDTH_TWIP = 11906;
const MARGIN_TWIP = 1134;
const CONTENT_TWIP = PAGE_WIDTH_TWIP - 2 * MARGIN_TWIP;
const CONTENT_PT = (CONTENT_TWIP / 20) * (96 / 72); // px at 96 dpi
const INK = "1A1A1A";
const ACCENT = "1F3864";
const RULE = "C8C8C8";
const BAND = "F2F4F8";
const MONO = "Consolas";

mkdirSync(WORK, { recursive: true });

/** Render every ```mermaid block to PNG and leave a placeholder in its place. */
const images = new Map();

function renderMermaid(markdown, prefix) {
  const blocks = [];
  const withPlaceholders = markdown.replace(/```mermaid\n([\s\S]*?)```/g, (_m, body) => {
    const id = `${prefix}-${String(blocks.length + 1).padStart(2, "0")}`;
    blocks.push({ id, body });
    return `@@DIAGRAM:${id}@@`;
  });
  if (blocks.length === 0) return withPlaceholders;

  const mmdc = process.platform === "win32" ? "mmdc.cmd" : "mmdc";
  const bin = join(ROOT, "tools", "node_modules", ".bin", mmdc);
  const runner = existsSync(bin) ? bin : mmdc;

  for (const { id, body } of blocks) {
    const src = join(WORK, `${id}.mmd`);
    const png = join(WORK, `${id}.png`);
    writeFileSync(src, body, "utf8");
    process.stdout.write(`  rendering ${id} ... `);
    try {
      execFileSync(runner, ["-i", src, "-o", png, "-b", "white", "-w", "1800", "-s", "2", "-q"], {
        stdio: "pipe",
        shell: process.platform === "win32",
      });
      images.set(id, readFileSync(png));
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(`    ${String(err.stderr || err.message).trim().split("\n")[0]}`);
    }
  }
  return withPlaceholders;
}

/** Intrinsic pixel size from the PNG header. */
const pngSize = (buf) => ({
  width: buf.readUInt32BE(16),
  height: buf.readUInt32BE(20),
});

console.log("Rendering diagrams");
const hld = renderMermaid(readFileSync(SOURCES.hld, "utf8"), "hld");
const decisions = renderMermaid(readFileSync(SOURCES.decisions, "utf8"), "adr");
const diagrams = renderMermaid(readFileSync(SOURCES.diagrams, "utf8"), "fig");

// Cross-document links become bookmark references once everything is merged.
const relink = (md) =>
  md
    .replace(/\]\((?:\.\.\/)*(?:docs\/solution\/)?decisions\.md(#[^)\s]*)?\)/g, "](#appendix-a--decision-log)")
    .replace(/\]\((?:\.\.\/)*(?:docs\/solution\/)?diagrams\.md(#[^)\s]*)?\)/g, "](#appendix-b--diagrams)")
    .replace(/\]\((?:\.\.\/)*(?:docs\/solution\/)?hld\.md(#[^)\s]*)?\)/g, "](#high-level-design--neobank-digital-leap)")
    .replace(/\]\([^)]*tools\/export-diagrams\.md\)/g, "](#appendix-b--diagrams)");

const assertSelfContained = (md, name) => {
  const outside = [...md.matchAll(/\]\(([^)\s]+)\)/g)]
    .map((m) => m[1])
    .filter((t) => !t.startsWith("#") && !/^https?:\/\//.test(t));
  if (outside.length) {
    throw new Error(
      `${name}: ${outside.length} link(s) resolve outside the document — ` +
        `${[...new Set(outside)].join(", ")}. The submission must be self-contained.`
    );
  }
  return md;
};

const merged = [
  assertSelfContained(relink(hld), "hld.md"),
  "\n\n@@PAGEBREAK@@\n\n# Appendix A — Decision Log\n",
  assertSelfContained(relink(decisions), "decisions.md").replace(/^# .*\n/, ""),
  "\n\n@@PAGEBREAK@@\n\n# Appendix B — Diagrams\n",
  assertSelfContained(relink(diagrams), "diagrams.md").replace(/^# .*\n/, ""),
].join("\n");

const slug = (text) =>
  text.toLowerCase().replace(/[^\w\s-]/g, "").replace(/\s/g, "-");

// Every heading is a bookmark target, so a link can only point inside the file.
const bookmarks = new Set();
for (const t of marked.lexer(merged)) {
  if (t.type === "heading") bookmarks.add(slug(t.text.replace(/[*_`]/g, "")));
}

const HEADING = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
  6: HeadingLevel.HEADING_6,
};

/** Inline markdown tokens to Word runs. */
function runs(tokens, style = {}) {
  const out = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case "strong":
        out.push(...runs(t.tokens, { ...style, bold: true }));
        break;
      case "em":
        out.push(...runs(t.tokens, { ...style, italics: true }));
        break;
      case "del":
        out.push(...runs(t.tokens, { ...style, strike: true }));
        break;
      case "codespan":
        out.push(new TextRun({ text: t.text, font: MONO, size: 18, color: "8A2B2B", ...style }));
        break;
      case "br":
        out.push(new TextRun({ break: 1 }));
        break;
      case "link": {
        if (t.href.startsWith("#")) {
          const anchor = t.href.slice(1);
          // A link to a heading that does not exist would be dead in Word, so
          // it degrades to plain text rather than shipping a broken reference.
          if (bookmarks.has(anchor)) {
            out.push(
              new InternalHyperlink({
                anchor,
                children: runs(t.tokens, { ...style, style: "Hyperlink" }),
              })
            );
          } else {
            out.push(...runs(t.tokens, style));
          }
        } else {
          out.push(
            new ExternalHyperlink({
              link: t.href,
              children: runs(t.tokens, { ...style, style: "Hyperlink" }),
            })
          );
        }
        break;
      }
      case "image":
        break;
      default:
        out.push(new TextRun({ text: t.raw ?? t.text ?? "", ...style }));
    }
  }
  return out;
}

/** A diagram placeholder becomes an embedded image scaled to the text width. */
function diagramParagraph(id) {
  const buf = images.get(id);
  if (!buf) {
    return new Paragraph({
      children: [new TextRun({ text: `[diagram ${id} did not render]`, italics: true })],
      spacing: { before: 120, after: 120 },
    });
  }
  const { width, height } = pngSize(buf);
  const scale = Math.min(1, CONTENT_PT / width);
  // Keep a tall diagram inside one page.
  const maxHeight = 820;
  const fit = Math.min(scale, maxHeight / height);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 160 },
    children: [
      new ImageRun({
        data: buf,
        type: "png",
        transformation: { width: Math.round(width * fit), height: Math.round(height * fit) },
      }),
    ],
  });
}

const cellRuns = (text) => {
  const parsed = marked.lexer(text.replace(/<br\s*\/?>/gi, "\n"));
  const inline = parsed.find((p) => p.type === "paragraph");
  return inline ? runs(inline.tokens) : [new TextRun({ text })];
};

function buildTable(token) {
  const widths = token.header.length;
  const row = (cells, header) =>
    new TableRow({
      tableHeader: header,
      children: cells.map(
        (c) =>
          new TableCell({
            width: { size: Math.floor(100 / widths), type: WidthType.PERCENTAGE },
            shading: header ? { type: ShadingType.CLEAR, fill: BAND } : undefined,
            margins: { top: 60, bottom: 60, left: 100, right: 100 },
            children: [
              new Paragraph({
                spacing: { before: 0, after: 0 },
                children: header
                  ? [new TextRun({ text: c.text.replace(/[*_`]/g, ""), bold: true, size: 18, color: INK })]
                  : cellRuns(c.text).map((r) => r),
              }),
            ],
          })
      ),
    });

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      bottom: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      left: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      right: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 2, color: RULE },
      insideVertical: { style: BorderStyle.SINGLE, size: 2, color: RULE },
    },
    rows: [row(token.header, true), ...token.rows.map((r) => row(r, false))],
  });
}

function listParagraphs(token, depth = 0) {
  const out = [];
  token.items.forEach((item, i) => {
    const first = item.tokens.find((t) => t.type === "text" || t.type === "paragraph");
    out.push(
      new Paragraph({
        numbering: token.ordered
          ? { reference: "ordered", level: depth, instance: 0 }
          : undefined,
        bullet: token.ordered ? undefined : { level: depth },
        spacing: { before: 40, after: 40 },
        children: first ? runs(first.tokens) : [new TextRun({ text: item.text })],
      })
    );
    for (const sub of item.tokens.filter((t) => t.type === "list")) {
      out.push(...listParagraphs(sub, depth + 1));
    }
  });
  return out;
}

/** Markdown tokens to Word block elements. */
function blocks(md) {
  const out = [];
  for (const token of marked.lexer(md)) {
    switch (token.type) {
      case "heading": {
        const clean = token.text.replace(/[*_`]/g, "");
        out.push(
          new Paragraph({
            heading: HEADING[token.depth],
            pageBreakBefore: token.depth === 1,
            spacing: { before: token.depth === 1 ? 0 : 240, after: 120 },
            border:
              token.depth === 1
                ? { bottom: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 4 } }
                : undefined,
            children: [
              new Bookmark({ id: slug(clean), children: runs(token.tokens) }),
            ],
          })
        );
        break;
      }
      case "paragraph": {
        const hit = token.text.match(/^@@DIAGRAM:([\w-]+)@@$/);
        if (hit) { out.push(diagramParagraph(hit[1])); break; }
        if (token.text.trim() === "@@PAGEBREAK@@") {
          out.push(new Paragraph({ children: [new PageBreak()] }));
          break;
        }
        out.push(
          new Paragraph({
            spacing: { before: 80, after: 80 },
            children: runs(token.tokens),
          })
        );
        break;
      }
      case "table":
        out.push(buildTable(token));
        out.push(new Paragraph({ text: "", spacing: { after: 120 } }));
        break;
      case "list":
        out.push(...listParagraphs(token));
        break;
      case "code":
        out.push(
          new Paragraph({
            shading: { type: ShadingType.CLEAR, fill: BAND },
            spacing: { before: 100, after: 100 },
            children: token.text.split("\n").flatMap((line, i) => [
              ...(i ? [new TextRun({ break: 1 })] : []),
              new TextRun({ text: line, font: MONO, size: 17, color: INK }),
            ]),
          })
        );
        break;
      case "blockquote":
        for (const inner of blocks(token.text)) {
          if (inner instanceof Paragraph) {
            out.push(
              new Paragraph({
                indent: { left: 340 },
                border: { left: { style: BorderStyle.SINGLE, size: 12, color: ACCENT, space: 8 } },
                spacing: { before: 80, after: 80 },
                children: inner.root.filter((c) => !(c && c.rootKey === "w:pPr")),
              })
            );
          } else out.push(inner);
        }
        break;
      case "hr":
        out.push(
          new Paragraph({
            spacing: { before: 160, after: 160 },
            border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: RULE, space: 1 } },
            children: [],
          })
        );
        break;
      case "space":
        break;
      default:
        if (token.text) {
          out.push(new Paragraph({ spacing: { before: 80, after: 80 }, children: [new TextRun(token.text)] }));
        }
    }
  }
  return out;
}

console.log("\nBuilding document");
const children = blocks(merged);

const doc = new Document({
  creator: AUTHOR,
  lastModifiedBy: AUTHOR,
  title: TITLE,
  description: "High Level Design for the NeoBank Digital Leap programme.",
  numbering: {
    config: [
      {
        reference: "ordered",
        levels: [0, 1, 2].map((level) => ({
          level,
          format: LevelFormat.DECIMAL,
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 360 * (level + 1), hanging: 260 } } },
        })),
      },
    ],
  },
  styles: {
    default: {
      document: { run: { font: "Calibri", size: 22, color: INK } },
      heading1: { run: { font: "Calibri", size: 40, bold: true, color: ACCENT } },
      heading2: { run: { font: "Calibri", size: 30, bold: true, color: ACCENT } },
      heading3: { run: { font: "Calibri", size: 24, bold: true, color: ACCENT } },
      heading4: { run: { font: "Calibri", size: 22, bold: true, color: INK } },
      heading5: { run: { font: "Calibri", size: 21, bold: true, color: INK } },
      heading6: { run: { font: "Calibri", size: 21, bold: true, italics: true, color: INK } },
    },
    paragraphStyles: [
      { id: "Hyperlink", name: "Hyperlink", basedOn: "DefaultParagraphFont", run: { color: ACCENT, underline: {} } },
    ],
  },
  sections: [
    {
      properties: {
        page: {
          size: { width: PAGE_WIDTH_TWIP, height: 16838 },
          margin: { top: MARGIN_TWIP, right: MARGIN_TWIP, bottom: MARGIN_TWIP, left: MARGIN_TWIP },
        },
      },
      children,
    },
  ],
});

const buffer = await Packer.toBuffer(doc);
writeFileSync(OUT, buffer);
console.log(`\nWrote build/${OUT.split(/[\\/]/).pop()} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);
console.log(`  ${children.length} block elements, ${images.size} diagrams, ${bookmarks.size} bookmarks`);
