import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING, isCourse } from "@/lib/paths";
import { claudeOnce } from "@/lib/claude";
import { modelFor } from "@/lib/models";
import { SYSTEM, buildPrompt, grounding, parseQuestions, pickGaps, readEvents, today, type Question } from "@/lib/asks";

// Warm-up from gaps: up to 3 multiple-choice questions written live from the learner's
// gaps, cached in learning/<course>/app-data/warmup/<YYYY-MM-DD>.json so the course gets
// the same questions all day and Claude is called at most once per course per day.
//   GET ?course=c&lesson=l  -> { date, questions } or { questions: [] }
// No gaps means no Claude call; a failed generation returns no questions and is retried
// on a later open (after a cool-down), never shown as an error.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Cache = { date: string; questions: Question[] };
const DAY = 24 * 60 * 60 * 1000;
const RETRY_AFTER = 10 * 60 * 1000;

const dirOf = (course: string) => path.join(LEARNING, course, "app-data", "warmup");

async function readCache(file: string): Promise<Cache | null> {
  try {
    const d = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(d?.questions) ? d : null;
  } catch {
    return null;
  }
}

// Questions from the last 3 days' caches, by text: the gap each one tested.
async function recentQuestions(course: string, now: number) {
  const map = new Map<string, string>();
  for (let i = 0; i < 4; i++) {
    const c = await readCache(path.join(dirOf(course), `${today(new Date(now - i * DAY))}.json`));
    for (const q of c?.questions ?? []) map.set(q.q, q.term ? q.term.replace(/\s+/g, " ").trim().toLowerCase() : q.q);
  }
  return map;
}

async function generate(course: string, file: string, date: string): Promise<Cache> {
  const now = Date.now();
  const evs = await readEvents(course);
  const gaps = pickGaps(evs, now, await recentQuestions(course, now));
  if (!gaps.length) return { date, questions: [] }; // nothing to ask; not cached, the next open looks again
  const notes = await grounding(course, gaps, evs);
  const raw = await claudeOnce({ feature: "warmup", course, model: await modelFor("warmup"), system: SYSTEM, prompt: buildPrompt(gaps, notes) });
  const questions = parseQuestions(raw, gaps);
  if (!questions) throw new Error("unusable reply");
  const cache = { date, questions };
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${now}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(cache, null, 1) + "\n");
  await fs.rename(tmp, file);
  return cache;
}

// One generation per cache file at a time; a failure is remembered for a while so every
// lesson open does not start another call.
const inflight = new Map<string, Promise<Cache>>();

export async function GET(req: Request) {
  const course = new URL(req.url).searchParams.get("course") ?? "";
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  const date = today();
  const file = path.join(dirOf(course), `${date}.json`);
  const cached = await readCache(file);
  if (cached) return Response.json(cached);

  let p = inflight.get(file);
  if (!p) {
    p = generate(course, file, date);
    inflight.set(file, p);
    p.then(
      () => inflight.delete(file),
      () => setTimeout(() => inflight.delete(file), RETRY_AFTER),
    );
  }
  try {
    return Response.json(await p);
  } catch {
    return Response.json({ questions: [] });
  }
}
