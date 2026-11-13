import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING, isCourse } from "@/lib/paths";

// Study-event log: learning/<course>/app-data/events.jsonl, one event per line,
// append-only. lib/events.ts batches events from the page and beacons them here.
//   POST { course, events }  -> appends the well-formed events (at most 200)
//   GET  ?course=c           -> every event in the file, in order

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX = 200;
const fileOf = (course: string) => path.join(LEARNING, course, "app-data", "events.jsonl");

type Obj = Record<string, unknown>;
const str = (v: unknown) => typeof v === "string";
const bool = (v: unknown) => typeof v === "boolean";
const num = (v: unknown) => typeof v === "number" && Number.isFinite(v);
const strOrNull = (v: unknown) => v === null || str(v);
const boolOrNull = (v: unknown) => v === null || bool(v);

// Required fields per kind (see the Ev type in lib/events.ts).
const KINDS: Record<string, Record<string, (v: unknown) => boolean>> = {
  read: { section: str, secs: num },
  explore: { term: str, from: strOrNull, section: str, context: str, card: str, seenBefore: bool },
  deepen: { card: str, term: str, level: (v) => v === 1 || v === 2 || v === 3 || v === 4 },
  ask: { term: strOrNull, section: str, text: str, level: (v) => v === "simple" || v === "mid" || v === "deep" },
  quiz: { section: str, q: str, right: bool, first: bool, fromGap: bool },
  lab: { section: str, lab: str, goal: bool, detail: str },
  done: { done: bool },
  clear: { term: str, v: boolOrNull },
  recall: { term: str, card: str, had: boolOrNull },
  note: { text: str },
};
const VIEWS = new Set(["canvas", "reader", "session"]);

function valid(e: unknown): e is Obj {
  if (!e || typeof e !== "object" || Array.isArray(e)) return false;
  const o = e as Obj;
  const fields = typeof o.kind === "string" ? KINDS[o.kind] : undefined;
  if (!fields || !str(o.t) || !str(o.lesson) || !VIEWS.has(o.view as string)) return false;
  return Object.entries(fields).every(([k, ok]) => ok(o[k]));
}

// One append chain per file, so two requests landing together never interleave lines.
const chains = new Map<string, Promise<unknown>>();
function append(file: string, text: string) {
  const next = (chains.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.appendFile(file, text);
    });
  chains.set(file, next);
  return next;
}

export async function POST(req: Request) {
  const { course, events } = (await req.json().catch(() => ({}))) as { course?: string; events?: unknown };
  if (!course || !Array.isArray(events)) return Response.json({ error: "bad request" }, { status: 400 });
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  const good = events.slice(0, MAX).filter(valid);
  if (good.length) await append(fileOf(course), good.map((e) => JSON.stringify(e) + "\n").join(""));
  return Response.json({ ok: true, added: good.length, dropped: events.length - good.length });
}

export async function GET(req: Request) {
  const course = new URL(req.url).searchParams.get("course") ?? "";
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  const text = await fs.readFile(fileOf(course), "utf8").catch(() => "");
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* a torn or hand-edited line: skip it */
    }
  }
  return Response.json(out);
}
