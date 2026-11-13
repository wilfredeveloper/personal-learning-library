// Teacher digest: what the learner did in one course, as evidence for the next lesson.
//
//   node scripts/digest.mjs <course> [--since YYYY-MM-DD]
//
// Reads <LEARNING>/<course>/app-data/events.jsonl, tutor.json and canvas/*.json, writes
// app-data/digest.md and prints its path. <LEARNING> is $LEARNING_DIR or ~/learning-library.
// Missing files, bad lines and unknown event kinds are skipped. Every list is capped.

import { promises as fs } from "node:fs";
import path from "node:path";
import { libraryDir } from "../lib/library-dir.mjs";

const LEARNING = libraryDir();
const SESSION_GAP = 45 * 60e3; // events closer than this belong to one session
const LONG_READ = 300; // seconds read in a section before a missed quiz there counts as a gap
const FIRST_Q = "Explain this passage"; // the reader's automatic first question (LessonReader.tsx)

// ---- args ----
const args = process.argv.slice(2);
const course = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--since");
const sinceArg = args.includes("--since") ? args[args.indexOf("--since") + 1] : null;
if (!course || !/^[a-z0-9-]+$/.test(course) || (args.includes("--since") && !/^\d{4}-\d{2}-\d{2}$/.test(sinceArg ?? ""))) {
  console.error("usage: node scripts/digest.mjs <course> [--since YYYY-MM-DD]");
  process.exit(1);
}
const since = sinceArg ? new Date(sinceArg + "T00:00:00").getTime() : -Infinity; // local midnight
const dir = path.join(LEARNING, course);
if (!(await fs.stat(dir).then((s) => s.isDirectory(), () => false))) {
  console.error(`no such course folder: ${dir}`);
  process.exit(1);
}
const appData = path.join(dir, "app-data");

// ---- read ----
const readText = (f) => fs.readFile(f, "utf8").catch(() => "");
const readJson = async (f) => {
  try {
    return JSON.parse(await fs.readFile(f, "utf8"));
  } catch {
    return null;
  }
};
const str = (v) => typeof v === "string";

const events = [];
for (const line of (await readText(path.join(appData, "events.jsonl"))).split("\n")) {
  if (!line.trim()) continue;
  let e;
  try {
    e = JSON.parse(line);
  } catch {
    continue;
  }
  const ms = e && str(e.t) ? Date.parse(e.t) : NaN;
  if (!Number.isFinite(ms) || !str(e.kind) || ms < since) continue;
  events.push({ ...e, ms, lesson: str(e.lesson) ? e.lesson : "?" });
}
events.sort((a, b) => a.ms - b.ms);

const tutor = await readJson(path.join(appData, "tutor.json"));
const threads = Array.isArray(tutor) ? tutor.filter((t) => t && Array.isArray(t.turns)) : [];

const canvases = [];
for (const f of await fs.readdir(path.join(appData, "canvas")).catch(() => [])) {
  if (!f.endsWith(".json")) continue;
  const c = await readJson(path.join(appData, "canvas", f));
  if (c && Array.isArray(c.cards)) canvases.push({ lesson: f.slice(0, -5), cards: c.cards.filter((x) => x && str(x.term)) });
}

// ---- helpers ----
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
const day = (ms) => {
  const d = new Date(ms);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
};
const when = (ms) => `${day(ms)} ${pad(new Date(ms).getHours())}:${pad(new Date(ms).getMinutes())}`;
const iso = (ms) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const clip = (s, n = 70) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const one = (s) => String(s).replace(/\s+/g, " ").trim();
const mins = (secs) => (secs > 0 && secs < 30 ? "<1 min" : `${Math.round(secs / 60)} min`);
const lessons = new Set(events.map((e) => e.lesson));
// Name a lesson only when the digest spans more than one.
const where = (lesson, section) => [section || null, lessons.size > 1 ? lesson : null].filter(Boolean).join(" · ") || lesson;
const capped = (list, n, fmt) => {
  const out = list.slice(0, n).map(fmt);
  if (list.length > n) out.push(`- +${list.length - n} more`);
  return out;
};
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;

// ---- sessions ----
let session = -1;
let lastMs = -Infinity;
for (const e of events) {
  if (e.ms - lastMs >= SESSION_GAP) session++;
  e.session = session;
  lastMs = e.ms;
}
const sessions = session + 1;

const out = [];
const write = async () => {
  await fs.mkdir(appData, { recursive: true });
  const file = path.join(appData, "digest.md");
  await fs.writeFile(file, out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n");
  console.log(file);
};

if (!events.length && !threads.some((t) => t.turns.some((x) => (x.at ?? 0) >= since))) {
  out.push(`# ${course} digest: no activity yet${sinceArg ? ` since ${sinceArg}` : ""} (written ${iso(Date.now())})`);
  await write();
  process.exit(0);
}

// ---- 1. header ----
const readSecs = events.filter((e) => e.kind === "read" && typeof e.secs === "number").reduce((s, e) => s + e.secs, 0);
out.push(`# ${course} digest`, "");
out.push(
  events.length
    ? `${day(events[0].ms)}${day(events[0].ms) === day(events.at(-1).ms) ? "" : ` – ${day(events.at(-1).ms)}`}${sinceArg ? ` (since ${sinceArg})` : ""} · ${plural(sessions, "session")} · ` +
        `${mins(readSecs)} reading · lessons: ${[...lessons].join(", ")}`
    : `No logged events${sinceArg ? ` since ${sinceArg}` : ""}; tutor threads only.`,
);
out.push(`Written ${iso(Date.now())} by scripts/digest.mjs. Evidence only; the learner never reads this.`, "");

// ---- 2. gaps ----
// Each term or section collects "triggers" (evidence of a gap) and "clears". A gap stands if
// some trigger came after the last clear; a term with triggers all before the last clear is recovered.
const REASON = ["failed recall", "said “not yet”", "opened in 2+ lessons/sessions", "deepened to level 3+", "quiz missed after a long read"];
const terms = new Map(); // term -> { triggers: [{p, ms}], clears: [ms], lastMs, lesson, section }
const T = (term) => {
  if (!terms.has(term)) terms.set(term, { triggers: [], clears: [], lastMs: 0, lesson: "", section: "" });
  return terms.get(term);
};
const seenIn = new Map(); // term -> { lessons:Set, sessions:Set }
const lower = (s) => s.toLowerCase();
for (const e of events) {
  if (str(e.term) && e.term) {
    const g = T(e.term);
    g.lastMs = e.ms;
    if (str(e.section) && e.section) [g.lesson, g.section] = [e.lesson, e.section];
    else if (!g.lesson) g.lesson = e.lesson;
  }
  if (e.kind === "explore" && str(e.term)) {
    const s = seenIn.get(e.term) ?? { lessons: new Set(), sessions: new Set() };
    s.lessons.add(e.lesson);
    s.sessions.add(e.session);
    seenIn.set(e.term, s);
    if (s.lessons.size > 1 || s.sessions.size > 1) T(e.term).triggers.push({ p: 2, ms: e.ms });
  } else if (e.kind === "recall" && str(e.term)) {
    if (e.had === false) T(e.term).triggers.push({ p: 0, ms: e.ms });
    if (e.had === true) T(e.term).clears.push(e.ms);
  } else if (e.kind === "clear" && str(e.term)) {
    if (e.v === false) T(e.term).triggers.push({ p: 1, ms: e.ms });
    if (e.v === true) T(e.term).clears.push(e.ms);
  } else if (e.kind === "deepen" && str(e.term) && e.level >= 3) {
    T(e.term).triggers.push({ p: 3, ms: e.ms });
  } else if (e.kind === "quiz" && e.fromGap === true && e.first === true && e.right === true && str(e.q)) {
    // A warm-up names its gap in `term`; older events without it count for a term their question or section names.
    for (const [term, g] of terms)
      if (str(e.term) ? lower(e.term) === lower(term) : lower(e.q).includes(lower(term)) || (str(e.section) && lower(e.section) === lower(term)))
        g.clears.push(e.ms);
  }
}

// Sections: a first-try miss after ≥ LONG_READ seconds read there; a later first-try right answer clears it.
const sections = new Map(); // lesson\0section -> same shape, plus reading and quiz tallies
const S = (e) => {
  const k = e.lesson + "\0" + (str(e.section) ? e.section : "");
  if (!sections.has(k))
    sections.set(k, { lesson: e.lesson, section: str(e.section) ? e.section : "", secs: 0, right: 0, tried: 0, triggers: [], clears: [], lastMs: 0, missed: [] });
  return sections.get(k);
};
// The score counts each question's first attempt ever; a later first-try answer (a retake on
// another visit) still clears or reopens the section's gap.
const firstSeen = new Map(); // lesson\0q -> the miss, if the first attempt was wrong
for (const e of events) {
  if (e.kind === "read" && typeof e.secs === "number") S(e).secs += e.secs;
  if (e.kind !== "quiz" || e.first !== true || !str(e.q) || e.fromGap === true) continue; // warm-ups test old gaps, not the lesson
  const s = S(e);
  const qk = e.lesson + "\0" + e.q;
  s.lastMs = e.ms;
  if (!firstSeen.has(qk)) {
    s.tried++;
    if (e.right) s.right++;
    else s.missed.push(e);
    firstSeen.set(qk, e.right ? null : e);
  } else if (e.right && firstSeen.get(qk) && !firstSeen.get(qk).retake) firstSeen.get(qk).retake = e.ms;
  if (e.right) s.clears.push(e.ms);
  else if (s.secs >= LONG_READ) s.triggers.push({ p: 4, ms: e.ms, q: e.q });
}

const gaps = [];
const recovered = [];
const judge = (name, g, isTerm) => {
  if (!g.triggers.length) return;
  const lastClear = Math.max(-Infinity, ...g.clears);
  const open = g.triggers.filter((x) => x.ms > lastClear);
  const item = { name, isTerm, g, lastClear, open, all: g.triggers };
  (open.length ? gaps : recovered).push(item);
};
for (const [term, g] of terms) judge(term, g, true);
for (const s of sections.values()) judge(s.section, s, false);

const reasons = (list) => [...new Set(list.map((x) => x.p))].sort().map((p) => REASON[p]).join(", ");
gaps.sort((a, b) => Math.min(...a.open.map((x) => x.p)) - Math.min(...b.open.map((x) => x.p)) || b.g.lastMs - a.g.lastMs);
recovered.sort((a, b) => b.lastClear - a.lastClear);
const label = (x) => (x.isTerm ? `**${x.name}**` : `**section “${x.name}”**`);
const place = (x) => (x.isTerm ? `, ${where(x.g.lesson, x.g.section)}` : lessons.size > 1 ? `, ${x.g.lesson}` : "");

if (gaps.length) {
  out.push("## Gaps, ranked", "");
  out.push(
    ...capped(gaps, 8, (x) => {
      const quiz = !x.isTerm ? ` (“${clip(one(x.open.at(-1).q ?? ""))}”, ${mins(x.g.secs)} read)` : "";
      return `- ${label(x)}: ${reasons(x.open)}${quiz}. Last seen ${when(x.g.lastMs)}${place(x)}.`;
    }),
    "",
  );
}
if (recovered.length) {
  out.push("## Recovered", "");
  out.push(...capped(recovered, 5, (x) => `- ${label(x)}: was ${reasons(x.all)}; cleared ${when(x.lastClear)}${place(x)}.`), "");
}

// ---- 3. questions ----
const norm = (s) => one(s).toLowerCase();
const asked = new Set();
const questions = [];
for (const e of events)
  if (e.kind === "ask" && str(e.text)) {
    asked.add(e.lesson + "\0" + norm(e.text));
    questions.push({ ms: e.ms, text: e.text, term: str(e.term) ? e.term : null, lesson: e.lesson, section: str(e.section) ? e.section : "" });
  }
for (const t of threads)
  for (const turn of t.turns) {
    if (!turn || !str(turn.q) || typeof turn.at !== "number" || turn.at < since) continue;
    if (asked.has((t.lesson ?? "?") + "\0" + norm(turn.q))) continue;
    questions.push({ ms: turn.at, text: turn.q, term: str(t.selection) && t.selection ? t.selection : null, lesson: t.lesson ?? "?", section: t.heading ?? "" });
  }
questions.sort((a, b) => b.ms - a.ms);
if (questions.length) {
  out.push("## Your questions, verbatim", "");
  out.push(
    ...capped(questions, 8, (q) => {
      const text = q.text === FIRST_Q ? "(asked to explain the passage)" : `“${one(q.text)}”`;
      return `- ${when(q.ms)} ${text}${q.term ? ` on *${clip(one(q.term), 50)}*` : ""}, ${where(q.lesson, q.section)}`;
    }),
    "",
  );
}

// ---- 4. notes ----
const notes = events.filter((e) => e.kind === "note" && str(e.text) && e.text.trim()).reverse();
if (notes.length) {
  out.push("## Your notes, verbatim", "");
  out.push(...capped(notes, 5, (e) => `- ${when(e.ms)} “${one(e.text)}”`), "");
}

// ---- 5. long chains ----
// Edges parent term -> child term, from explore.from and from canvas cards' parentId.
const kids = new Map();
const hasParent = new Set();
const edge = (a, b) => {
  if (!a || !b || a === b) return;
  if (!kids.has(a)) kids.set(a, new Set());
  kids.get(a).add(b);
  hasParent.add(b);
};
const nodes = new Set();
for (const e of events)
  if (e.kind === "explore" && str(e.term)) {
    nodes.add(e.term);
    if (str(e.from)) edge(e.from, e.term);
  }
for (const c of canvases) {
  const byId = new Map(c.cards.map((x) => [x.id, x]));
  for (const x of c.cards) {
    nodes.add(x.term);
    if (x.parentId && byId.has(x.parentId)) edge(byId.get(x.parentId).term, x.term);
  }
}
const chains = [];
const walk = (term, trail) => {
  const next = [...(kids.get(term) ?? [])].filter((k) => !trail.includes(k));
  if (!next.length) {
    if (trail.length >= 3) chains.push(trail);
    return;
  }
  for (const k of next) walk(k, [...trail, k]);
};
for (const n of new Set([...nodes, ...kids.keys()])) if (!hasParent.has(n)) walk(n, [n]);
chains.sort((a, b) => b.length - a.length);
if (chains.length) {
  out.push("## Long chains (a prerequisite the lesson skipped?)", "");
  out.push(...capped(chains, 5, (c) => `- ${c.join(" → ")}`), "");
}

// ---- 6. where the time went ----
const bySecs = [...sections.values()].filter((s) => s.secs > 0).sort((a, b) => b.secs - a.secs);
if (bySecs.length) {
  out.push("## Where the time went", "");
  out.push(
    ...capped(bySecs, 8, (s) => `- ${where(s.lesson, s.section)}: ${mins(s.secs)}${s.tried ? `; quiz ${s.right}/${s.tried} first try` : ""}`),
    "",
  );
}

// ---- 7. quizzes ----
const byLesson = new Map();
for (const s of sections.values()) {
  if (!s.tried) continue;
  const l = byLesson.get(s.lesson) ?? { right: 0, tried: 0, missed: [] };
  l.right += s.right;
  l.tried += s.tried;
  l.missed.push(...s.missed);
  byLesson.set(s.lesson, l);
}
if (byLesson.size) {
  out.push("## Quizzes (first try)", "");
  for (const [lesson, l] of byLesson) {
    out.push(`- ${lesson}: ${l.right}/${l.tried}`);
    l.missed.sort((a, b) => a.ms - b.ms);
    out.push(...capped(l.missed, 5, (e) => `  - missed “${one(e.q)}” (${e.section}, ${when(e.ms)}${e.retake ? `; right on a retake ${when(e.retake)}` : ""})`).map((s) => (s.startsWith("- +") ? "  " + s : s)));
  }
  out.push("");
}

await write();
