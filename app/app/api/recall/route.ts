import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING, isCourse } from "@/lib/paths";
import { claudeOnce } from "@/lib/claude";
import { modelFor } from "@/lib/models";

// "Recall first?" questions for reused canvas cards. Each old card gets one question,
// written once by Claude from that card's text and kept in
// learning/<course>/app-data/recall.json ({ [old card id]: { term, q, t } }),
// so the same card is never sent to Claude twice.
//   POST { course, card, term, text } -> { q } or { error }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CARD = /^[a-z0-9]{1,40}$/;
type Store = Record<string, { term: string; q: string; t: string }>;

const fileOf = (course: string) => path.join(LEARNING, course, "app-data", "recall.json");

async function readStore(file: string): Promise<Store> {
  try {
    const data = JSON.parse(await fs.readFile(file, "utf8"));
    return data && typeof data === "object" && !Array.isArray(data) ? data : {};
  } catch {
    return {};
  }
}

// One read-modify-write chain per file, so two questions finishing together both land.
const chains = new Map<string, Promise<unknown>>();
function save(file: string, card: string, entry: Store[string]) {
  const next = (chains.get(file) ?? Promise.resolve())
    .catch(() => {})
    .then(async () => {
      const store = await readStore(file);
      store[card] = entry;
      await fs.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(store, null, 1) + "\n");
      await fs.rename(tmp, file);
    });
  chains.set(file, next);
  return next;
}

// A card asked for twice at once (two tabs, a quick reload) shares one Claude call.
const pending = new Map<string, Promise<string>>();

const SYSTEM =
  "You write one recall question for a learner who explained a term to themselves before and is about to see that note again. " +
  "The question must make them retrieve the core idea from memory: ask what it is, does or why it matters, in at most 20 words. " +
  "Do not include the answer or quote the note. Reply with the question only: no preamble, no quotes, no markdown.";

async function generate(course: string, term: string, text: string): Promise<string> {
  const out = await claudeOnce({
    feature: "recall",
    course,
    model: await modelFor("recall"),
    system: SYSTEM,
    prompt: `Term: "${term}"\n\nTheir earlier note:\n"""\n${text}\n"""`,
    timeoutMs: 30_000,
  });
  const q = out.replace(/\s+/g, " ").trim().replace(/^["“]|["”]$/g, "").trim();
  if (q.length < 5 || q.length > 300) throw new Error("unusable question");
  return q;
}

export async function POST(req: Request) {
  const { course, card, term, text } = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof course !== "string" || typeof card !== "string" || !CARD.test(card) || typeof term !== "string" || typeof text !== "string")
    return Response.json({ error: "bad request" }, { status: 400 });
  const t = term.replace(/\s+/g, " ").trim().slice(0, 300);
  const body = text.trim().slice(0, 3000);
  if (!t || !body) return Response.json({ error: "bad request" }, { status: 400 });
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });

  const file = fileOf(course);
  const hit = (await readStore(file))[card];
  if (hit?.q) return Response.json({ q: hit.q });

  const key = `${course}/${card}`;
  let job = pending.get(key);
  if (!job) {
    job = generate(course, t, body).then(async (q) => {
      await save(file, card, { term: t, q, t: new Date().toISOString() });
      return q;
    });
    pending.set(key, job);
    job.catch(() => {}).finally(() => pending.delete(key));
  }
  try {
    return Response.json({ q: await job });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
