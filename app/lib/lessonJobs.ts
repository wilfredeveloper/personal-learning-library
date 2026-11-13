import { spawn } from "node:child_process";
import { openSync, closeSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { LEARNING } from "@/lib/paths";

// Lesson jobs: "write my next lesson" runs of the /teach skill, started from the app.
//   <LEARNING>/<course>/app-data/jobs/<id>.json   the job (this file and scripts/lesson-job.mjs write it)
//   <LEARNING>/<course>/app-data/jobs/<id>.log    the runner's output: claude's stream-json lines
// The runner is a detached Node process, so a job outlives app reloads. One job per course at a time.
// Server only.

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export type LessonJob = {
  id: string;
  course: string;
  status: JobStatus;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  pid?: number; // the runner's pid, which is also its process group id
  note?: string; // the learner's note to the teacher, verbatim
  lesson?: { slug: string; title: string; file: string }; // file is relative to the course folder
  error?: string; // why it failed
  warning?: string; // done, but something after the lesson needs attention (e.g. not published)
  durationMs?: number;
  costUsd?: number;
  progress?: string; // added when listing: the latest thing the run said or did
};

const COURSE = /^[a-z0-9-]+$/;
const ID = /^[a-z0-9-]+$/;
const RUNNER = path.join(process.cwd(), "scripts", "lesson-job.mjs");
const QUEUED_GRACE_MS = 60_000; // a queued job with no runner pid after this long never started

const jobsDir = (course: string) => path.join(LEARNING, course, "app-data", "jobs");
const jobFile = (course: string, id: string) => path.join(jobsDir(course), `${id}.json`);

async function readJob(file: string): Promise<LessonJob | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

async function writeJob(job: LessonJob) {
  const file = jobFile(job.course, job.id);
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  const { progress: _drop, ...rest } = job; // eslint-disable-line @typescript-eslint/no-unused-vars
  await fs.writeFile(tmp, JSON.stringify(rest, null, 1) + "\n");
  await fs.rename(tmp, file);
}

function pidAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

const active = (j: LessonJob) => j.status === "queued" || j.status === "running";

// An active job whose runner is gone (machine restarted, runner crashed) is marked failed.
async function reap(job: LessonJob): Promise<LessonJob> {
  if (!active(job)) return job;
  const dead = job.pid ? !pidAlive(job.pid) : Date.now() - Date.parse(job.createdAt) > QUEUED_GRACE_MS;
  if (!dead) return job;
  // re-read: the runner may have just written its final status
  const now = (await readJob(jobFile(job.course, job.id))) ?? job;
  if (!active(now)) return now;
  const failed: LessonJob = { ...now, status: "failed", error: "runner stopped", finishedAt: new Date().toISOString() };
  await writeJob(failed);
  return failed;
}

// The last assistant message in the log, as one short line: its text, or the tool it called.
async function progressOf(course: string, id: string): Promise<string | undefined> {
  let tail = "";
  try {
    const fh = await fs.open(path.join(jobsDir(course), `${id}.log`), "r");
    try {
      const { size } = await fh.stat();
      const len = Math.min(size, 256 * 1024);
      const buf = Buffer.alloc(len);
      await fh.read(buf, 0, len, size - len);
      tail = buf.toString("utf8");
    } finally {
      await fh.close();
    }
  } catch {
    return undefined;
  }
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let ev: { type?: string; message?: { content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[] } };
    try {
      ev = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (ev.type !== "assistant") continue;
    const items = ev.message?.content ?? [];
    for (let k = items.length - 1; k >= 0; k--) {
      const c = items[k];
      if (c.type === "text" && c.text?.trim()) return clip(c.text.trim().split("\n")[0]);
      if (c.type === "tool_use" && c.name) {
        const arg = c.input?.file_path ?? c.input?.pattern ?? c.input?.query ?? c.input?.url ?? c.input?.command;
        return clip(typeof arg === "string" ? `${c.name}: ${path.basename(arg)}` : c.name);
      }
    }
  }
  return undefined;
}

const clip = (s: string) => (s.length > 140 ? s.slice(0, 139) + "…" : s);

export async function listJobs(course?: string): Promise<LessonJob[]> {
  let courses: string[];
  if (course) courses = [course];
  else courses = (await fs.readdir(LEARNING, { withFileTypes: true }).catch(() => []))
    .filter((d) => d.isDirectory() && COURSE.test(d.name) && !d.name.startsWith("_"))
    .map((d) => d.name);
  const jobs: LessonJob[] = [];
  for (const c of courses) {
    const files = await fs.readdir(jobsDir(c)).catch(() => [] as string[]);
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const j = await readJob(path.join(jobsDir(c), f));
      if (j) jobs.push(await reap(j));
    }
  }
  jobs.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  for (const j of jobs) if (active(j)) j.progress = await progressOf(j.course, j.id);
  return jobs;
}

// Starts are serialised so two quick clicks can't both pass the "one job per course" check.
let starting: Promise<unknown> = Promise.resolve();

/** Starts the next-lesson job for a course, or returns the job already running there. */
export function startJob(course: string, note?: string): Promise<{ job: LessonJob; started: boolean }> {
  const run = starting.then(() => start(course, note));
  starting = run.catch(() => {});
  return run;
}

async function start(course: string, note?: string): Promise<{ job: LessonJob; started: boolean }> {
  const running = (await listJobs(course)).find(active);
  if (running) return { job: running, started: false };

  const now = new Date();
  const id = `${now.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${randomBytes(3).toString("hex")}`.toLowerCase();
  const job: LessonJob = { id, course, status: "queued", createdAt: now.toISOString(), ...(note ? { note } : {}) };
  await writeJob(job);

  const log = openSync(path.join(jobsDir(course), `${id}.log`), "a");
  try {
    // detached: own process group (so cancel can kill claude and its children too) and no tie to this server
    const child = spawn(process.execPath, [RUNNER, jobFile(course, id)], {
      detached: true,
      stdio: ["ignore", log, log],
      env: { ...process.env, LEARNING_DIR: LEARNING },
    });
    child.on("error", () => {}); // reap() marks it failed if it never started
    child.unref();
  } finally {
    closeSync(log);
  }
  return { job, started: true };
}

export async function cancelJob(course: string, id: string): Promise<LessonJob | null> {
  if (!ID.test(id)) return null;
  const job = await readJob(jobFile(course, id));
  if (!job) return null;
  if (!active(job)) return job;
  if (job.pid) {
    try {
      process.kill(-job.pid, "SIGTERM"); // the whole group: runner, claude, its tools
    } catch {
      /* already gone */
    }
  }
  const now = (await readJob(jobFile(course, id))) ?? job;
  if (!active(now)) return now;
  const cancelled: LessonJob = {
    ...now,
    status: "cancelled",
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - Date.parse(now.startedAt ?? now.createdAt),
  };
  await writeJob(cancelled);
  return cancelled;
}
