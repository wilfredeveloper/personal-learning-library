// Check the external links of a course's lessons and cheat sheets, the way the app will open
// them. Used by the teach skill before it finishes a lesson (the lesson job allows exactly
// this command), and by hand.
//
//   node scripts/check-links.mjs <course>              every lesson and cheat sheet of the course
//   node scripts/check-links.mjs <course> <file>...    only these (paths relative to the course)
//
// Each link is fetched (or its kept copy reused, lib/external.mjs) and reported:
//   CANVAS  opens beside the lesson on the canvas (web page, or PDF drawn with a text layer)
//   TAB     can't be read here (refused, broken, needs scripts): find an open alternative
//   UNCHECKED  couldn't be reached from this computer just now (no verdict)
// Fetched copies are kept, so publishing afterwards (sync-courses) reuses them.
// The learning folder comes from LEARNING_DIR (set by the lesson job), else VAULT, else the default.
// Exit code 0 even with TAB links: they are advice, not errors.

import { promises as fs } from "node:fs";
import path from "node:path";
import { libraryDir } from "../lib/library-dir.mjs";
import { checkAll } from "../lib/external.mjs";

const APP = path.resolve(import.meta.dirname, "..");
const LEARNING = process.env.LEARNING_DIR || process.env.VAULT || libraryDir();
const [course, ...files] = process.argv.slice(2);
if (!course || !/^[\w.-]+$/.test(course)) {
  console.error("usage: node scripts/check-links.mjs <course> [lessons/<file>.html ...]");
  process.exit(1);
}
const dir = path.join(LEARNING, course);

let paths = files.map((f) => path.resolve(dir, f));
if (!paths.length)
  for (const sub of ["lessons", "reference"]) {
    const names = await fs.readdir(path.join(dir, sub)).catch(() => []);
    for (const n of names.filter((n) => n.endsWith(".html")).sort()) paths.push(path.join(dir, sub, n));
  }
if (paths.some((p) => !p.startsWith(dir + path.sep))) {
  console.error("files must be inside the course folder");
  process.exit(1);
}

const htmls = [];
for (const p of paths) htmls.push(await fs.readFile(p, "utf8").catch(() => ""));
const { urls, metas, misses } = await checkAll(APP, htmls);

const counts = { CANVAS: 0, TAB: 0, UNCHECKED: 0 };
for (const u of urls) {
  const m = metas.get(u);
  const tag = !m ? "UNCHECKED" : m.open === "canvas" ? "CANVAS" : "TAB";
  counts[tag]++;
  const note = !m ? `  ${misses.get(u) ?? ""}` : m.open === "tab" ? `  ${m.why}` : m.kind === "pdf" ? "  (PDF)" : m.final !== u ? `  (-> ${m.final})` : "";
  console.log(`${tag.padEnd(9)} ${u}${note}`);
}
console.log(`\n${urls.length} links in ${paths.length} files: ${counts.CANVAS} canvas, ${counts.TAB} tab, ${counts.UNCHECKED} unchecked`);
