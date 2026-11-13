import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING, isCourse } from "@/lib/paths";

// Past canvas cards of one course, across all its lessons, read from
// learning/<course>/app-data/canvas/<lesson>.json. The canvas reuses them when a term
// comes up again, instead of asking Claude to explain it a second time.
//   GET ?course=c -> [{ lesson, card, term, level, parts, createdAt? }]
// parts holds only the finished levels (the done prefix); cards with none are left out.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LESSON = /^[a-z0-9-]+$/;

type Saved = { id?: unknown; term?: unknown; level?: unknown; parts?: unknown; status?: unknown; createdAt?: unknown };
export type PastCard = { lesson: string; card: string; term: string; level: number; parts: string[]; createdAt?: number };

export async function GET(req: Request) {
  const course = new URL(req.url).searchParams.get("course") ?? "";
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  const dir = path.join(LEARNING, course, "app-data", "canvas");
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const out: PastCard[] = [];
  for (const f of files) {
    const lesson = f.endsWith(".json") ? f.slice(0, -5) : "";
    if (!LESSON.test(lesson)) continue;
    let cards: Saved[] = [];
    try {
      const data = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as { cards?: unknown };
      if (Array.isArray(data?.cards)) cards = data.cards as Saved[];
    } catch {
      continue; // a torn or hand-edited file: skip it
    }
    for (const c of cards) {
      if (!c || typeof c.id !== "string" || typeof c.term !== "string" || !Array.isArray(c.parts) || !Array.isArray(c.status)) continue;
      // Levels stream in order, so the finished ones are a prefix.
      const parts: string[] = [];
      for (let i = 0; i < 4 && c.status[i] === "done" && typeof c.parts[i] === "string"; i++) parts.push(c.parts[i] as string);
      if (!parts.length) continue;
      const level = typeof c.level === "number" && c.level >= 1 && c.level <= 4 ? Math.floor(c.level) : 1;
      out.push({
        lesson,
        card: c.id,
        term: c.term,
        level,
        parts,
        ...(typeof c.createdAt === "number" ? { createdAt: c.createdAt } : {}),
      });
    }
  }
  return Response.json(out);
}
