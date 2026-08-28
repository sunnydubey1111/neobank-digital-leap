# Building the submission document

The design is authored as Markdown with Mermaid diagrams. The submission is a **single Word
file with the diagrams embedded**. This directory holds the build that turns one into the other.

## One command

```bash
cd tools && npm install       # first time only
cd .. && node tools/build-docx.mjs
```

Output: `build/NeoBank-HLD-Sunny-Dubey.docx` — the file to submit.

The build writes the Office Open XML package directly. Word is not involved, so the result does
not depend on a Word installation and cannot pick up anything from the machine that produced it.

## What the build does

1. Extracts every ` ```mermaid ` block from [`hld.md`](../docs/solution/hld.md),
   [`decisions.md`](../docs/solution/decisions.md) and
   [`diagrams.md`](../docs/solution/diagrams.md).
2. Renders each block to PNG at 2× scale on a white background, via `mermaid-cli`.
3. Embeds each PNG as a package part, scaled to the text width.
4. Concatenates the three documents into one: the High Level Design, then Appendix A (the
   Decision Log), then Appendix B (the full diagram set).
5. Gives every heading a bookmark and turns each cross-reference into a bookmark link, so a
   reference cannot resolve to anything outside the file.
6. Applies the page setup and styling — A4, 2 cm margins, Calibri, banded tables, a page break
   before each top-level heading.

A link that is neither an in-document anchor nor a public URL fails the build. That is deliberate:
such a link would otherwise become an absolute path to the build machine.

Intermediate `.mmd` sources and rendered `.png` files are left in `build/diagrams/` so
individual diagrams can be pulled out and used on their own.

## Rendering one diagram by hand

```bash
tools/node_modules/.bin/mmdc -i diagram.mmd -o diagram.png -b white -w 1800 -s 2
```

For an interactive preview while editing, paste the block into <https://mermaid.live>.

## Keeping diagrams legible in print

At A4 with 2 cm margins the usable width is about 17 cm. A diagram wider than roughly 3.5 : 1
ends up with text too small to read once scaled to that width. Anything approaching that ratio
should be split rather than shrunk. This is why the container diagram is drawn as two views
(§3.1 cloud, §3.2 on-premises) instead of one — the combined version was legible on screen and
unreadable on paper.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `Parse error on line N` | A `;` in a node or message label — Mermaid reads it as a statement separator. Use a comma |
| `… link(s) resolve outside the document` | A Markdown link points at a file rather than a heading or a URL |
| `[diagram … did not render]` in the output | The build continues past failures. The error line is printed above it |
| `mmdc` not found | `npm install` has not been run in `tools/` |
