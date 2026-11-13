import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING, isCourse } from "@/lib/paths";

// App state kept as plain JSON files in the learning folder, next to each course:
//   <library>/<course>/app-data/progress.json
//   <library>/<course>/app-data/tutor.json
//   <library>/<course>/app-data/canvas/<lesson>.json
// The browser keeps its localStorage copy as a cache; these files are what survive
// a new browser or port and what the teacher reads when planning the next lesson.
//   GET  ?course=c&name=n  -> that file's JSON, or null
//   GET  ?name=n           -> { [course]: data } for every course that has the file
//   PUT  { course, name, data }

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COURSE = /^[a-z0-9-]+$/;
const NAME = /^(progress|tutor|canvas\/[a-z0-9-]+)$/;

const fileOf = (course: string, name: string) => path.join(LEARNING, course, "app-data", `${name}.json`);

async function readJson(file: string) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const name = q.get("name") ?? "";
  const course = q.get("course");
  if (!NAME.test(name)) return Response.json({ error: "bad name" }, { status: 400 });
  if (course) {
    if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
    return Response.json(await readJson(fileOf(course, name)));
  }
  const out: Record<string, unknown> = {};
  for (const d of await fs.readdir(LEARNING, { withFileTypes: true }))
    if (d.isDirectory() && COURSE.test(d.name)) {
      const data = await readJson(fileOf(d.name, name));
      if (data !== null) out[d.name] = data;
    }
  return Response.json(out);
}

export async function PUT(req: Request) {
  const { course, name, data } = (await req.json().catch(() => ({}))) as { course?: string; name?: string; data?: unknown };
  if (!course || !name || !NAME.test(name) || data === undefined) return Response.json({ error: "bad request" }, { status: 400 });
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  const file = fileOf(course, name);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // write then rename, so a reader never sees half a file
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 1) + "\n");
  await fs.rename(tmp, file);
  return Response.json({ ok: true });
}
