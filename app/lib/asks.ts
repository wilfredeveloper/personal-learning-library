import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING } from "@/lib/paths";
import type { Ev } from "@/lib/events";

// Warm-up from gaps (docs/journey/SCOPE.md, WP6): pick up to 3 gaps from the study log,
// ground each in what the learner already saw (their old card, the passage, the missed
// question) and turn the result of one Claude call into checked, shuffled questions.
// Server only; /api/warmup does the caching.

export type GapKind = "recall" | "not-yet" | "repeat" | "quiz";
export type Gap = { kind: GapKind; term: string | null; q?: string; section?: string; lesson: string };
export type Question = { id: string; gap: GapKind; term: string | null; q: string; options: string[]; answer: number };

const DAY = 24 * 60 * 60 * 1000;
const SESSION_GAP = 45 * 60 * 1000; // same as the canvas: events further apart start a new session
const LONG_READ = 5 * 60; // seconds read in a section before a missed quiz counts as a gap
export const WARMUP_SECTION = "From last time";

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const time = (e: { t: string }) => Date.parse(e.t) || 0;

export async function readEvents(course: string): Promise<Ev[]> {
  const text = await fs.readFile(path.join(LEARNING, course, "app-data", "events.jsonl"), "utf8").catch(() => "");
  const out: Ev[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e.kind === "string" && typeof e.t === "string") out.push(e);
    } catch {
      /* torn line */
    }
  }
  return out.sort((a, b) => time(a) - time(b));
}

/**
 * Up to 3 gaps, newest first within each kind, in the order: failed recall, "not yet",
 * term opened in 2+ lessons or sessions, quiz missed on the first try after a long read.
 * `rightQs` maps a warm-up question's text to its term (or to itself for a quiz gap),
 * so a gap answered right in a warm-up in the last 3 days is skipped.
 */
export function pickGaps(evs: Ev[], now: number, rightQs: Map<string, string>): Gap[] {
  const recent = (e: Ev) => now - time(e) < 3 * DAY;
  const done = new Set<string>(); // term keys (or quiz question texts) checked right lately
  for (const e of evs) {
    if (!recent(e)) continue;
    if (e.kind === "clear" && e.v === true) done.add(norm(e.term));
    if (e.kind === "recall" && e.had === true) done.add(norm(e.term));
    if (e.kind === "quiz" && e.fromGap && e.right) {
      const key = typeof e.term === "string" ? norm(e.term) : rightQs.get(e.q); // older answers lack `term`
      if (key) done.add(key);
    }
  }

  const out: Gap[] = [];
  const taken = new Set<string>();
  const add = (key: string, g: Gap) => {
    if (out.length >= 3 || taken.has(key) || done.has(key)) return;
    taken.add(key);
    out.push(g);
  };
  const newest = [...evs].reverse();

  for (const e of newest) if (e.kind === "recall" && e.had === false) add(norm(e.term), { kind: "recall", term: e.term, lesson: e.lesson });
  for (const e of newest) if (e.kind === "clear" && e.v === false) add(norm(e.term), { kind: "not-yet", term: e.term, lesson: e.lesson });

  // Sessions: a new one starts after 45 minutes without any event.
  const sessionOf = new Map<Ev, number>();
  let s = 0;
  evs.forEach((e, i) => {
    if (i > 0 && time(e) - time(evs[i - 1]) > SESSION_GAP) s++;
    sessionOf.set(e, s);
  });
  const seen = new Map<string, { term: string; lesson: string; lessons: Set<string>; sessions: Set<number> }>();
  for (const e of newest) {
    if (e.kind !== "explore") continue;
    const k = norm(e.term);
    const r = seen.get(k) ?? { term: e.term, lesson: e.lesson, lessons: new Set(), sessions: new Set() };
    r.lessons.add(e.lesson);
    r.sessions.add(sessionOf.get(e)!);
    seen.set(k, r);
  }
  for (const [k, r] of seen) if (r.lessons.size > 1 || r.sessions.size > 1) add(k, { kind: "repeat", term: r.term, lesson: r.lesson });

  for (const e of newest) {
    if (e.kind !== "quiz" || e.fromGap || e.right || !e.first) continue;
    const read = evs
      .filter((r) => r.kind === "read" && r.lesson === e.lesson && r.section === e.section && time(r) <= time(e))
      .reduce((n, r) => n + (r.kind === "read" ? r.secs : 0), 0);
    if (read >= LONG_READ) add(e.q, { kind: "quiz", term: null, q: e.q, section: e.section, lesson: e.lesson });
  }
  return out;
}

type SavedCard = { term?: string; parts?: string[]; status?: string[]; createdAt?: number };

/** What the learner already saw for each gap: their old card (parts 1–3), the passage, or the missed question. */
export async function grounding(course: string, gaps: Gap[], evs: Ev[]): Promise<string[]> {
  const dir = path.join(LEARNING, course, "app-data", "canvas");
  const cards: SavedCard[] = [];
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
    if (!f.endsWith(".json")) continue;
    try {
      const d = JSON.parse(await fs.readFile(path.join(dir, f), "utf8"));
      if (Array.isArray(d?.cards)) cards.push(...d.cards);
    } catch {
      /* unreadable file */
    }
  }
  cards.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return gaps.map((g) => {
    const lines: string[] = [];
    if (g.term) {
      const key = norm(g.term);
      const card = cards.find((c) => typeof c.term === "string" && norm(c.term) === key);
      const text = (card?.parts ?? [])
        .slice(0, 3)
        .filter((p, i) => card?.status?.[i] === "done" && typeof p === "string" && p.trim())
        .join("\n\n");
      if (text) lines.push(`Their old card on it:\n${text.slice(0, 2400)}`);
      const ex = [...evs].reverse().find((e) => e.kind === "explore" && norm(e.term) === key);
      if (ex?.kind === "explore" && ex.context) lines.push(`The passage they were reading:\n${ex.context}`);
    } else if (g.q) {
      lines.push(`The quiz question they missed (section "${g.section}"):\n${g.q}`);
    }
    return lines.join("\n\n") || "(no notes saved)";
  });
}

const WHY: Record<GapKind, string> = {
  recall: "they could not recall it when it came up again",
  "not-yet": 'they said it was "not yet" clear',
  repeat: "they looked it up in more than one lesson or session",
  quiz: "they missed this quiz question on the first try after reading the section for a while",
};

export const SYSTEM =
  "You write short warm-up questions for a learner returning to a course. Each question tests whether they still hold the idea, " +
  "not whether they remember wording. Plain text, no markdown, no LaTeX. Reply with strict JSON only, no prose, no code fences.";

export function buildPrompt(gaps: Gap[], notes: string[]): string {
  const items = gaps
    .map((g, i) => `### g${i + 1}\nTopic: ${g.term ?? "the idea behind the missed question"}\nWhy it is a gap: ${WHY[g.kind]}\n${notes[i]}`)
    .join("\n\n");
  return (
    `Write one multiple-choice question for each of the ${gaps.length} gaps below (${gaps.map((_, i) => `g${i + 1}`).join(", ")}): ` +
    `exactly ${gaps.length} questions, even when a gap has few notes.\n\n${items}\n\n` +
    "Rules:\n" +
    "- Ask about the idea itself (what it does, why it matters, what changes if it changes). Never quote a sentence and ask to fill a blank.\n" +
    "- Ground it in the learner's notes above; do not test facts they never saw.\n" +
    "- The question is at most 25 words. Exactly 3 options, each at most 10 words, all about the same length and the same grammatical form, so length gives nothing away.\n" +
    "- The two wrong options are plausible mistakes, not jokes.\n" +
    "- Put the correct option FIRST; the app shuffles them.\n\n" +
    'Reply with: {"questions":[{"id":"g1","q":"...","options":["correct","wrong","wrong"]}, ...]}'
  );
}

/** Parse Claude's reply into checked questions with shuffled options; null if it is unusable. */
export function parseQuestions(raw: string, gaps: Gap[]): Question[] | null {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let data: unknown;
  try {
    data = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const list = (data as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) return null;
  const out: Question[] = [];
  gaps.forEach((g, i) => {
    const id = `g${i + 1}`;
    const it = list.find((x) => x && typeof x === "object" && (x as { id?: unknown }).id === id) as { q?: unknown; options?: unknown } | undefined;
    if (!it || typeof it.q !== "string" || !it.q.trim() || !Array.isArray(it.options) || it.options.length !== 3) return;
    const opts = it.options.map((o) => (typeof o === "string" ? o.trim() : ""));
    if (opts.some((o) => !o || o.length > 160) || new Set(opts.map(norm)).size !== 3) return;
    // Fisher–Yates; the correct option came first.
    const order = [0, 1, 2];
    for (let j = 2; j > 0; j--) {
      const k = Math.floor(Math.random() * (j + 1));
      [order[j], order[k]] = [order[k], order[j]];
    }
    out.push({ id, gap: g.kind, term: g.term, q: it.q.trim(), options: order.map((o) => opts[o]), answer: order.indexOf(0) });
  });
  return out.length ? out : null;
}

/** Local calendar date, YYYY-MM-DD (the cache is one file per course per day). */
export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
