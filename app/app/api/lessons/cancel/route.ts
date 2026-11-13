import { isCourse } from "@/lib/paths";
import { isLocalRequest, notLocal } from "@/lib/local";
import { cancelJob } from "@/lib/lessonJobs";

// POST { course, id } -> { job }: kills the job's process group and marks it cancelled.
// A job that already finished is returned as it is.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return notLocal();
  const { course, id } = (await req.json().catch(() => ({}))) as { course?: unknown; id?: unknown };
  if (typeof course !== "string" || typeof id !== "string") return Response.json({ error: "bad request" }, { status: 400 });
  if (!(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  const job = await cancelJob(course, id);
  if (!job) return Response.json({ error: "no such job" }, { status: 404 });
  return Response.json({ job });
}
