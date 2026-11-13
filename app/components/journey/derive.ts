// Pure derivations for the Journey page: everything it shows is computed here from the
// course's study events (lib/events.ts). `cut` is the replay position: only events[0..cut)
// count, so the page can show the state at any point in time.

import type { Ev } from "@/lib/events";

export const SESSION_GAP_MS = 45 * 60e3; // a pause longer than this starts a new session

/** A lesson as the page knows it: its section names in document order (h1 first, then each h2). */
export type LessonOutline = { slug: string; title: string; sections: string[] };

/** Events in time order (the log is append-only, but beacons can land slightly out of order). */
export function sortEvents(evs: Ev[]): Ev[] {
  return evs
    .map((e, i) => ({ e, i, t: Date.parse(e.t) }))
    .filter((x) => Number.isFinite(x.t))
    .sort((a, b) => a.t - b.t || a.i - b.i)
    .map((x) => x.e);
}

/* ---------------- sessions ---------------- */

/** Event indices [start, end], inclusive. */
export type Session = { start: number; end: number };

export function sessions(evs: Ev[]): Session[] {
  const out: Session[] = [];
  evs.forEach((e, i) => {
    const cur = out[out.length - 1];
    if (cur && Date.parse(e.t) - Date.parse(evs[cur.end].t) < SESSION_GAP_MS) cur.end = i;
    else out.push({ start: i, end: i });
  });
  return out;
}

export const sessionIndexOf = (ss: Session[], i: number) => ss.findIndex((s) => i >= s.start && i <= s.end);

/* ---------------- terms ---------------- */

/** true = got it, false = not yet, null = not marked. */
export type Standing = boolean | null;

export type TermState = {
  term: string;
  from: string | null;
  lesson: string;
  section: string;
  first: number; // index of the first explore
  depth: number; // 1..4 reached
  asks: number;
  standing: Standing;
  events: number[]; // every event about this term, in order
};

/** A warm-up question ("From last time", WP6) names the gap term it was written for in its `section`. */
// Warm-up answers name their gap in `term`; events logged before that field existed fall back to the section.
export const gapTerm = (e: Ev): string | null =>
  e.kind === "quiz" && e.fromGap ? (e.term !== undefined ? e.term : e.section) : null;

/** The term an event is about, if any. */
export function termOf(e: Ev): string | null {
  switch (e.kind) {
    case "explore":
    case "deepen":
    case "clear":
    case "recall":
    case "ask":
      return e.term;
    case "quiz":
      return gapTerm(e);
    default:
      return null;
  }
}

/** What an event says about whether the learner has the term, or undefined if it says nothing. */
function verdictOf(e: Ev): boolean | undefined {
  if (e.kind === "clear" && e.v !== null) return e.v;
  if (e.kind === "recall" && e.had !== null) return e.had;
  if (e.kind === "quiz" && e.fromGap) return e.right;
  return undefined;
}

/** Each term opened before `cut`, keyed by its text. Events about a term before it was opened are ignored. */
export function termsAt(evs: Ev[], cut = evs.length): Map<string, TermState> {
  const m = new Map<string, TermState>();
  evs.slice(0, cut).forEach((e, i) => {
    const term = termOf(e);
    if (term === null) return;
    let t = m.get(term);
    if (!t) {
      if (e.kind !== "explore") return;
      t = { term, from: e.from, lesson: e.lesson, section: e.section, first: i, depth: 1, asks: 0, standing: null, events: [] };
      m.set(term, t);
    }
    t.events.push(i);
    if (e.kind === "deepen") t.depth = Math.max(t.depth, e.level);
    if (e.kind === "ask") t.asks++;
    const v = verdictOf(e);
    if (v !== undefined) t.standing = v; // the latest verdict wins
  });
  return m;
}

export function standingCounts(terms: Map<string, TermState>) {
  let got = 0;
  let notYet = 0;
  for (const t of terms.values()) {
    if (t.standing === true) got++;
    else if (t.standing === false) notYet++;
  }
  return { opened: terms.size, got, notYet };
}

/* ---------------- trails ---------------- */

export const sectionKey = (lesson: string, section: string) => `${lesson}\u0000${section}`;

export type TrailNode = { term: string; parent: string | null; depth: number; row: number };

/**
 * The trail trees, one per (lesson, section): a trail starts where its root term was opened, and
 * every term opened from a card (`explore.from`) hangs under that card's term, wherever it was
 * opened. Nodes are in pre-order; `row` is the node's line in its section's drawing.
 * Also returns, for every term, the section key its trail lives in.
 */
export function trails(terms: Map<string, TermState>) {
  const kids = new Map<string, TermState[]>();
  for (const t of terms.values())
    if (t.from !== null && t.from !== t.term && terms.has(t.from)) {
      const list = kids.get(t.from) ?? [];
      list.push(t);
      kids.set(t.from, list);
    }
  for (const list of kids.values()) list.sort((a, b) => a.first - b.first);

  const bySection = new Map<string, TrailNode[]>();
  const home = new Map<string, string>(); // term -> section key of its trail
  const place = (t: TermState, parent: string | null, depth: number, key: string) => {
    if (home.has(t.term)) return; // guards against a cycle in `from`
    home.set(t.term, key);
    const nodes = bySection.get(key) ?? [];
    nodes.push({ term: t.term, parent, depth, row: nodes.length });
    bySection.set(key, nodes);
    for (const k of kids.get(t.term) ?? []) place(k, t.term, depth + 1, key);
  };
  const ordered = [...terms.values()].sort((a, b) => a.first - b.first);
  for (const t of ordered) if (t.from === null || !terms.has(t.from)) place(t, null, 0, sectionKey(t.lesson, t.section));
  for (const t of ordered) place(t, null, 0, sectionKey(t.lesson, t.section)); // anything left only by a cycle
  return { bySection, home };
}

/* ---------------- reading time ---------------- */

/** Seconds read per (lesson, section) per session, counting events before `cut`. */
export function readingAt(evs: Ev[], ss: Session[], cut = evs.length): Map<string, number[]> {
  const out = new Map<string, number[]>();
  let si = 0;
  for (let i = 0; i < Math.min(cut, evs.length); i++) {
    while (si < ss.length - 1 && i > ss[si].end) si++;
    const e = evs[i];
    if (e.kind !== "read") continue;
    const key = sectionKey(e.lesson, e.section);
    const per = out.get(key) ?? new Array<number>(ss.length).fill(0);
    per[si] += e.secs;
    out.set(key, per);
  }
  return out;
}

/* ---------------- quizzes and notes ---------------- */

/** Lesson quizzes on the first try: the first answer ever given to each question. Warm-ups don't count here. */
export function firstTry(evs: Ev[], cut = evs.length) {
  const seen = new Map<string, boolean>();
  for (const e of evs.slice(0, cut))
    if (e.kind === "quiz" && !e.fromGap) {
      const key = sectionKey(e.lesson, e.q);
      if (!seen.has(key)) seen.set(key, e.right);
    }
  return { right: [...seen.values()].filter(Boolean).length, total: seen.size };
}

export function notes(evs: Ev[], cut = evs.length) {
  const out: { i: number; text: string }[] = [];
  evs.slice(0, cut).forEach((e, i) => {
    if (e.kind === "note" && e.text.trim()) out.push({ i, text: e.text });
  });
  return out;
}

/* ---------------- rows ---------------- */

export type LessonBlock = { slug: string; title: string; number: number | null; sections: string[] };

/** The section an event was in, for placing it in a row. Warm-ups name a term, not a section. */
function sectionOf(e: Ev): string | null {
  switch (e.kind) {
    case "read":
    case "explore":
    case "ask":
    case "lab":
      return e.section;
    case "quiz":
      return e.fromGap ? null : e.section;
    default:
      return null;
  }
}

/**
 * One block per lesson that has events, in course order (lessons the course no longer lists go
 * last, named by their slug). Each block's sections are the lesson's own, in document order,
 * then any section seen only in events, in the order first seen.
 */
export function lessonBlocks(outline: LessonOutline[], evs: Ev[]): LessonBlock[] {
  const seen = new Map<string, string[]>(); // lesson -> sections seen in events, first-seen order
  for (const e of evs) {
    const list = seen.get(e.lesson) ?? [];
    seen.set(e.lesson, list);
    const s = sectionOf(e);
    if (s !== null && !list.includes(s)) list.push(s);
  }
  const blocks: LessonBlock[] = [];
  outline.forEach((l, i) => {
    const extra = seen.get(l.slug);
    if (!extra) return;
    blocks.push({ slug: l.slug, title: l.title, number: i + 1, sections: [...l.sections, ...extra.filter((s) => !l.sections.includes(s))] });
    seen.delete(l.slug);
  });
  for (const [slug, sections] of seen) blocks.push({ slug, title: slug, number: null, sections });
  return blocks;
}

/* ---------------- words ---------------- */

/** One line saying what an event was, for the replay caption. */
export function describe(e: Ev): string {
  switch (e.kind) {
    case "read":
      return `read § ${e.section}`;
    case "explore":
      return `opened “${e.term}”`;
    case "deepen":
      return `went to depth ${e.level} on “${e.term}”`;
    case "ask":
      return `asked “${e.text}”`;
    case "quiz":
      return e.fromGap
        ? `${e.right ? "got" : "missed"} a warm-up on “${e.section}”: ${e.q}`
        : `${e.right ? "got" : "missed"} a quiz: ${e.q}`;
    case "lab":
      return `lab: ${e.detail}`;
    case "done":
      return e.done ? "marked the lesson done" : "marked the lesson not done";
    case "clear":
      return e.v === null ? `skipped “Still clear?” on “${e.term}”` : `said “${e.term}” is ${e.v ? "still clear" : "not clear yet"}`;
    case "recall":
      return e.had === null ? `opened “${e.term}” again` : `${e.had ? "recalled" : "couldn’t recall"} “${e.term}” before the card`;
    case "note":
      return `wrote: “${e.text}”`;
  }
}

/** "Wed 19:40" */
export function when(t: string): string {
  const a = new Date(t);
  return a.toLocaleDateString("en-GB", { weekday: "short" }) + " " + a.toTimeString().slice(0, 5);
}

/** ["Wed 11", "19:40"]: the column label for a session starting at t. */
export function sessionLabel(t: string): [string, string] {
  const a = new Date(t);
  return [a.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" }), a.toTimeString().slice(0, 5)];
}
