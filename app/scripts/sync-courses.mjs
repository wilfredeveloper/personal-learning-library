// Publish every course in the learning library into this app.
//
// Copies each course's lessons/, reference/ and a per-course assets/ (resolved
// from the shared symlink) into public/courses/<slug>/, preserving the folder
// layout so every relative link and interactive figure keeps working as-is.
// Then: rewrites the two "up" crumb links to app routes, injects the
// highlight->Ask-Claude bridge, and writes content/embedded-courses.json.
// Before copying, every external link in the lessons and cheat sheets is fetched (or its kept
// copy reused) by lib/external.mjs, so it opens on the canvas at once, and each link is marked:
// data-open="canvas" (data-kind="pdf" for a PDF) or data-open="tab" when the site can't be read.
//
// Re-run to republish:  node scripts/sync-courses.mjs
// (or `pnpm sync`). Point at a different library with VAULT=/path node scripts/sync-courses.mjs
// NO_PREFETCH=1 skips the fetching; links whose result is already kept are still marked.

import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { libraryDir } from "../lib/library-dir.mjs";
import { checkAll, externalLinks, markLinks, readMeta } from "../lib/external.mjs";

const VAULT = process.env.VAULT || libraryDir();
// Every course folder in the library: not hidden or "_shared", with a lessons/ folder and an index.html.
const COURSES = (await fs.readdir(VAULT, { withFileTypes: true }))
  .filter((e) => e.isDirectory() && !/^[._]/.test(e.name))
  .map((e) => e.name)
  .filter((n) => existsSync(path.join(VAULT, n, "lessons")) && existsSync(path.join(VAULT, n, "index.html")))
  .sort();
const APP = path.resolve(import.meta.dirname, "..");
const PUBLIC_COURSES = path.join(APP, "public", "courses");

const pick = (html, re) => {
  const m = html.match(re);
  return m ? m[1].replace(/\s+/g, " ").trim() : "";
};
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s) =>
  s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n] ?? m);
const stripTags = (s) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

// Title / lede / minutes / eyebrow straight from the lesson's own markup.
function lessonMeta(html) {
  return {
    title: stripTags(pick(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i)),
    lede: stripTags(pick(html, /class="lede"[^>]*>([\s\S]*?)<\/p>/i)),
    minutes: pick(html, /<b>\s*(\d+)\s*min<\/b>/i),
    eyebrow: stripTags(pick(html, /class="eyebrow"[^>]*>([\s\S]*?)<\/p>/i)),
  };
}

// Rewrite the vault crumbs (which point at the vault's own hub pages) to the
// app routes, and make them escape the iframe. Inject the ask bridge.
function prepareLesson(html, slug, metas) {
  let out = markLinks(html, metas);
  out = out
    .replace(/href="\.\.\/\.\.\/index\.html"/g, 'href="/learn" target="_parent"')
    .replace(/href="\.\.\/index\.html"/g, `href="/learn/${slug}" target="_parent"`);
  if (!out.includes("/ask-bridge.js")) {
    out = out.replace(/<\/body>/i, '<script src="/ask-bridge.js"></script>\n</body>');
  }
  return out;
}

async function copyDir(src, dst, transform) {
  await fs.mkdir(dst, { recursive: true });
  for (const entry of await fs.readdir(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    // readdir follows the assets symlink's *name* but entry.isFile() reflects target
    if (entry.isDirectory()) {
      await copyDir(s, d, transform);
    } else if (transform && entry.name.endsWith(".html")) {
      await fs.writeFile(d, transform(await fs.readFile(s, "utf8")));
    } else {
      await fs.copyFile(s, d);
    }
  }
}

async function listHtml(dir) {
  try {
    return (await fs.readdir(dir)).filter((f) => f.endsWith(".html")).sort();
  } catch {
    return [];
  }
}

async function syncCourse(slug) {
  const srcCourse = path.join(VAULT, slug);
  const dstCourse = path.join(PUBLIC_COURSES, slug);

  // External links: fetch each (or reuse its kept copy) before the old copy is removed.
  const htmls = [];
  for (const sub of ["lessons", "reference"])
    for (const file of await listHtml(path.join(srcCourse, sub))) htmls.push(await fs.readFile(path.join(srcCourse, sub, file), "utf8"));
  let metas;
  let misses = new Map();
  if (process.env.NO_PREFETCH) {
    metas = new Map();
    for (const u of new Set(htmls.flatMap(externalLinks))) {
      const m = await readMeta(APP, u);
      if (m) metas.set(u, m);
    }
  } else ({ metas, misses } = await checkAll(APP, htmls));
  const all = new Set(htmls.flatMap(externalLinks)).size;
  const tab = [...metas.values()].filter((m) => m.open === "tab");
  const pdf = [...metas.values()].filter((m) => m.kind === "pdf").length;
  console.log(
    `  ${slug}: ${all} external links: ${metas.size - tab.length} open on the canvas (${pdf} PDF), ${tab.length} in a browser tab` +
      (all > metas.size ? `, ${all - metas.size} not checked (couldn't reach them)` : ""),
  );
  for (const m of tab) console.log(`    tab: ${m.url} (${m.why})`);
  for (const [u, why] of misses) console.log(`    not checked: ${u} (${why})`);

  await fs.rm(dstCourse, { recursive: true, force: true });

  // Per-course assets, resolved through the ../_shared/assets symlink.
  await copyDir(path.join(srcCourse, "assets"), path.join(dstCourse, "assets"));

  // Lessons (with crumb rewrite + bridge injection).
  await copyDir(path.join(srcCourse, "lessons"), path.join(dstCourse, "lessons"), (h) =>
    prepareLesson(h, slug, metas),
  );
  // Cheat sheets (same treatment so their crumbs work too).
  await copyDir(path.join(srcCourse, "reference"), path.join(dstCourse, "reference"), (h) =>
    prepareLesson(h, slug, metas),
  );

  const indexHtml = await fs.readFile(path.join(srcCourse, "index.html"), "utf8");
  const courseTitle = stripTags(pick(indexHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/i)) || slug;

  const lessons = [];
  for (const file of await listHtml(path.join(srcCourse, "lessons"))) {
    const html = await fs.readFile(path.join(srcCourse, "lessons", file), "utf8");
    lessons.push({ file, slug: file.replace(/\.html$/, ""), ...lessonMeta(html) });
  }
  const reference = [];
  for (const file of await listHtml(path.join(srcCourse, "reference"))) {
    const html = await fs.readFile(path.join(srcCourse, "reference", file), "utf8");
    reference.push({ file, slug: file.replace(/\.html$/, ""), title: lessonMeta(html).title });
  }

  console.log(`  ${slug}: ${lessons.length} lessons, ${reference.length} cheat sheets`);
  return { slug, title: courseTitle, lessons, reference };
}

const courses = [];
console.log("Publishing courses into the app:");
for (const slug of COURSES) courses.push(await syncCourse(slug));

const manifestPath = path.join(APP, "content", "embedded-courses.json");
await fs.mkdir(path.dirname(manifestPath), { recursive: true });
await fs.writeFile(manifestPath, JSON.stringify({ courses }, null, 2) + "\n");
console.log(`Manifest -> ${path.relative(APP, manifestPath)}`);
