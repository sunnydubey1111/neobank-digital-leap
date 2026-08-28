/**
 * Normalises the document properties of the built Word file.
 *
 *   node tools/normalise-metadata.mjs
 *
 * Word stamps the signed-in account identifier into "last modified by" when it
 * saves. The document properties should carry a name rather than an account
 * identifier, so that field is normalised to the author's name. Nothing else is
 * altered: the creator, the revision count and both timestamps are left exactly
 * as Word wrote them.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTHOR = "Sunny Dubey";
const FILE = join(ROOT, "build", "NeoBank-HLD-Sunny-Dubey.docx");

const zip = await JSZip.loadAsync(readFileSync(FILE));
const core = await zip.file("docProps/core.xml").async("string");

const before = core.match(/<cp:lastModifiedBy>([^<]*)<\/cp:lastModifiedBy>/)?.[1] ?? "(absent)";
const after = core.replace(
  /<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/,
  `<cp:lastModifiedBy>${AUTHOR}</cp:lastModifiedBy>`
);

if (after === core) {
  console.log(`last modified by: "${before}" — already ${AUTHOR}, nothing to do`);
} else {
  zip.file("docProps/core.xml", after);
  writeFileSync(FILE, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  console.log(`last modified by: "${before}" -> "${AUTHOR}"`);
}
