import { isCourse } from "@/lib/paths";
import { isLocalRequest, notLocal } from "@/lib/local";
import { startJob } from "@/lib/lessonJobs";

// POST { course, note? } -> 202 { job }: starts the /teach run for the course's next lesson
// (scripts/lesson-job.mjs, detached). 409 { job } if one is already queued or running there.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_NOTE = 4000;

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return notLocal();
  const { course, note } = (await req.json().catch(() => ({}))) as { course?: unknown; note?: unknown };
  if (typeof course !== "string" || (note !== undefined && typeof note !== "string"))
    return Response.json({ error: "bad request" }, { status: 400 });
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  if (note && note.length > MAX_NOTE) return Response.json({ error: `note is longer than ${MAX_NOTE} characters` }, { status: 400 });
  const { job, started } = await startJob(course, note?.trim() || undefined);
  return Response.json({ job }, { status: started ? 202 : 409 });
}
