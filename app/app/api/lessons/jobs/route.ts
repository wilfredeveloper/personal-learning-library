import { isCourse } from "@/lib/paths";
import { isLocalRequest, notLocal } from "@/lib/local";
import { listJobs } from "@/lib/lessonJobs";

// GET ?course=c -> { jobs } for that course; no course -> every course's jobs. Newest first;
// queued/running jobs carry a short `progress` line from their log.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isLocalRequest(req)) return notLocal();
  const course = new URL(req.url).searchParams.get("course");
  if (course && !(await isCourse(course))) return Response.json({ error: "no such course" }, { status: 404 });
  return Response.json({ jobs: await listJobs(course ?? undefined) });
}
