# Building the submission document

The design is authored as Markdown with Mermaid diagrams. The submission is a **single Word
file with the diagrams embedded**. This directory holds the build that turns one into the other.

## Two commands

```bash
cd tools && npm install                  # first time only
cd .. && node tools/build-submission.mjs # renders diagrams, builds the document
powershell -ExecutionPolicy Bypass -File tools/to-docx.ps1
```

Output: `build/NeoBank-HLD-Sunny-Dubey.docx` — the file to submit.

The second step drives Microsoft Word through COM to perform the conversion, so the result is
byte-for-byte what opening the file and choosing **Save As → Word Document** would produce.
Word must be installed; if it is not, open `build/NeoBank-HLD-Sunny-Dubey.doc` manually and use
Save As instead. Either way the output is one self-contained file with every diagram embedded.

## What the build does

1. Extracts every ` ```mermaid ` block from [`hld.md`](../docs/solution/hld.md),
   [`decisions.md`](../docs/solution/decisions.md) and
   [`diagrams.md`](../docs/solution/diagrams.md).
2. Renders each block to PNG at 2× scale on a white background, via `mermaid-cli`.
3. Embeds each PNG as a base64 data URI, so the output has no external file dependencies.
4. Concatenates the three documents into one: the High Level Design, then Appendix A (the
   Decision Log), then Appendix B (the full diagram set).
5. Rewrites the cross-document links into intra-document anchors, so every reference still
   resolves inside the single file.
6. Wraps it in Word-compatible HTML with print styling — A4, Calibri, banded tables, page breaks
   before top-level headings.

Intermediate `.mmd` sources and rendered `.png` files are left in `build/diagrams/` so
individual diagrams can be pulled out and used on their own.

## Rendering one diagram by hand

```bash
tools/node_modules/.bin/mmdc -i diagram.mmd -o diagram.png -b white -w 1800 -s 2
```

For an interactive preview while editing, paste the block into <https://mermaid.live>.

## Keeping diagrams legible in print

At A4 with 2 cm margins the usable width is about 17 cm. A diagram wider than roughly 3.5 : 1
ends up with text too small to read once scaled to that width. The build prints the pixel
dimensions of each render; anything approaching that ratio should be split rather than shrunk.
This is why the container diagram is drawn as two views (§2.1 cloud, §2.2 on-premises) instead
of one — the combined version was legible on screen and unreadable on paper.

## Troubleshooting

| Symptom | Cause |
|---------|-------|
| `Parse error on line N` | A `;` in a node or message label — Mermaid reads it as a statement separator. Use a comma |
| A diagram renders as `[diagram … did not render]` | The build continues past failures. The error line is printed above it |
| `mmdc` not found | `npm install` has not been run in `tools/` |
| Word opens the file as plain text | Confirm the extension is `.doc`, not `.txt` |
