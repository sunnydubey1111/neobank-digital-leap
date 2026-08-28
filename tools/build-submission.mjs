/**
 * Builds the single-file submission document.
 *
 * Renders every Mermaid block in the design docs to PNG, embeds each one as a
 * data URI, concatenates the High Level Design with the Decision Log and the
 * diagram set, and writes one self-contained document that Microsoft Word opens
 * directly.
 *
 *   node tools/build-submission.mjs
 *
 * Output: build/NeoBank-HLD-<author>.doc
 * Open it in Word and use Save As -> .docx to produce the file to submit.
 */

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { marked } from "marked";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = join(ROOT, "build");
const WORK = join(BUILD, "diagrams");
const AUTHOR = "Sunny Dubey";
const OUT = join(BUILD, `NeoBank-HLD-${AUTHOR.replace(/\s+/g, "-")}.doc`);

const SOURCES = {
  hld: join(ROOT, "docs", "solution", "hld.md"),
  decisions: join(ROOT, "docs", "solution", "decisions.md"),
  diagrams: join(ROOT, "docs", "solution", "diagrams.md"),
};

rmSync(BUILD, { recursive: true, force: true });
mkdirSync(WORK, { recursive: true });

/** Render every ```mermaid block to PNG and swap in an embedded image. */
function renderMermaid(markdown, prefix) {
  const blocks = [];
  const withPlaceholders = markdown.replace(
    /```mermaid\n([\s\S]*?)```/g,
    (_match, body) => {
      const id = `${prefix}-${String(blocks.length + 1).padStart(2, "0")}`;
      blocks.push({ id, body });
      return `@@DIAGRAM:${id}@@`;
    }
  );

  if (blocks.length === 0) return withPlaceholders;

  const mmdc = process.platform === "win32" ? "mmdc.cmd" : "mmdc";
  const bin = join(ROOT, "tools", "node_modules", ".bin", mmdc);
  const runner = existsSync(bin) ? bin : mmdc;

  let out = withPlaceholders;
  for (const { id, body } of blocks) {
    const src = join(WORK, `${id}.mmd`);
    const png = join(WORK, `${id}.png`);
    writeFileSync(src, body, "utf8");

    process.stdout.write(`  rendering ${id} ... `);
    try {
      execFileSync(
        runner,
        ["-i", src, "-o", png, "-b", "white", "-w", "1800", "-s", "2", "-q"],
        { stdio: "pipe", shell: process.platform === "win32" }
      );
      const data = readFileSync(png).toString("base64");
      out = out.replace(
        `@@DIAGRAM:${id}@@`,
        `<p><img src="data:image/png;base64,${data}" alt="${id}"></p>`
      );
      console.log("ok");
    } catch (err) {
      console.log("FAILED");
      console.error(`    ${String(err.stderr || err.message).trim().split("\n")[0]}`);
      out = out.replace(
        `@@DIAGRAM:${id}@@`,
        `<p><em>[diagram ${id} did not render — see Appendix B]</em></p>`
      );
    }
  }
  return out;
}

console.log("Rendering diagrams");
const hld = renderMermaid(readFileSync(SOURCES.hld, "utf8"), "hld");
const decisions = renderMermaid(readFileSync(SOURCES.decisions, "utf8"), "adr");
const diagrams = renderMermaid(readFileSync(SOURCES.diagrams, "utf8"), "fig");

// Cross-document links become intra-document anchors once everything is merged.
const relink = (md) =>
  md
    .replace(/\]\((?:\.\.\/)*(?:docs\/solution\/)?decisions\.md(#[^)\s]*)?\)/g, "](#appendix-a--decision-log)")
    .replace(/\]\((?:\.\.\/)*(?:docs\/solution\/)?diagrams\.md(#[^)\s]*)?\)/g, "](#appendix-b--diagrams)")
    .replace(/\]\((?:\.\.\/)*(?:docs\/solution\/)?hld\.md(#[^)\s]*)?\)/g, "](#high-level-design--neobank-digital-leap)")
    .replace(/\]\([^)]*tools\/export-diagrams\.md\)/g, "](#appendix-b--diagrams)");

const assertSelfContained = (md, name) => {
  // Anything that is not an in-document anchor or a public URL would become a
  // file:// relationship in Word and break the moment the document is moved.
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
  "\n\n<div style='page-break-before:always'></div>\n\n",
  "# Appendix A — Decision Log\n",
  assertSelfContained(relink(decisions), "decisions.md").replace(/^# .*\n/, ""),
  "\n\n<div style='page-break-before:always'></div>\n\n",
  "# Appendix B — Diagrams\n",
  assertSelfContained(relink(diagrams), "diagrams.md").replace(/^# .*\n/, ""),
].join("\n");

// Word builds bookmarks from <a name>, not from heading id attributes, so the
// anchors every cross-reference points at are emitted explicitly. Slugs follow
// the same rule the source documents assume: lowercase, punctuation dropped,
// whitespace to hyphens.
const slug = (text) =>
  text
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s/g, "-");

const anchored = (h) =>
  h.replace(
    /<h([1-6])>([\s\S]*?)<\/h\1>/g,
    (_, level, inner) => `<h${level}><a name="${slug(inner)}">${inner}</a></h${level}>`
  );

const contents = (h) => {
  const rows = [];
  for (const m of h.matchAll(/<h([12])><a name="([^"]+)">([\s\S]*?)<\/a><\/h\1>/g)) {
    const [, level, name, inner] = m;
    const label = inner.replace(/<[^>]+>/g, "");
    if (/^contents$/i.test(label)) continue;
    rows.push(
      `<p class="toc${level}"><a href="#${name}">${label}</a></p>`
    );
  }
  return `<h1><a name="contents">Contents</a></h1>\n${rows.join("\n")}\n` +
    `<div style='page-break-before:always'></div>\n`;
};

const parsed = anchored(marked.parse(merged, { mangle: false }));
const body = contents(parsed) + parsed;

const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office"
      xmlns:w="urn:schemas-microsoft-com:office:word"
      xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>NeoBank Digital Leap — High Level Design</title>
<style>
  @page { size: A4; margin: 2cm; }
  body { font-family: Calibri, "Segoe UI", sans-serif; font-size: 11pt; line-height: 1.45; color: #1a1a1a; }
  a { color: #1f3864; }
  .toc1 { margin: 6pt 0 2pt 0; font-weight: 600; }
  .toc2 { margin: 1pt 0 1pt 16pt; }
  .toc1 a, .toc2 a { text-decoration: none; }
  h1 { font-size: 20pt; color: #1f3864; border-bottom: 2px solid #1f3864; padding-bottom: 4pt; page-break-before: always; }
  h1:first-of-type { page-break-before: avoid; }
  h2 { font-size: 15pt; color: #1f3864; margin-top: 18pt; }
  h3 { font-size: 12.5pt; color: #2e5496; margin-top: 14pt; }
  h4 { font-size: 11pt; color: #2e5496; }
  table { border-collapse: collapse; width: 100%; margin: 8pt 0; font-size: 9.5pt; }
  th, td { border: 1px solid #b4c6e7; padding: 4pt 6pt; text-align: left; vertical-align: top; }
  th { background: #d9e2f3; font-weight: 600; }
  tr:nth-child(even) td { background: #f4f7fc; }
  img { max-width: 100%; height: auto; }
  code { font-family: Consolas, monospace; font-size: 9.5pt; background: #f2f2f2; padding: 1pt 3pt; }
  pre { background: #f7f7f7; border: 1px solid #ddd; padding: 8pt; font-size: 9pt; white-space: pre-wrap; }
  blockquote { border-left: 3px solid #b4c6e7; margin-left: 0; padding-left: 12pt; color: #444; }
  hr { border: 0; border-top: 1px solid #ccc; }
</style>
</head>
<body>
${body}
</body>
</html>`;

writeFileSync(OUT, html, "utf8");

const kb = Math.round(Buffer.byteLength(html) / 1024);
console.log(`\nWrote ${OUT} (${kb} KB)`);
console.log("Open it in Word, then Save As -> Word Document (.docx) to produce the submission file.");
