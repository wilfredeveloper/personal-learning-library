"use client";

// Course-page panel: ask the teacher (the /teach skill, run in the background) for the next
// lesson, watch it being written, open it when it's done. See app/api/lessons and
// scripts/lesson-job.mjs. LessonNotifier tells the learner on other pages.

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { LessonJob } from "@/lib/lessonJobs";
import { JOB_STARTED } from "@/components/LessonNotifier";
import "@/app/lessons.css";

const POLL_MS = 10_000;
const active = (j?: LessonJob) => j?.status === "queued" || j?.status === "running";
const minutes = (j: LessonJob) => Math.max(0, Math.floor((Date.now() - Date.parse(j.startedAt ?? j.createdAt)) / 60_000));

export default function NextLesson({ course }: { course: string }) {
  const [job, setJob] = useState<LessonJob | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    const r = await fetch(`/api/lessons/jobs?course=${course}`).catch(() => null);
    if (r?.ok) setJob(((await r.json()) as { jobs: LessonJob[] }).jobs[0]);
    setLoaded(true);
  }, [course]);

  useEffect(() => {
    // first load right away, then keep polling only while a job is being written
    const first = setTimeout(refresh, 0);
    return () => clearTimeout(first);
  }, [refresh]);
  const running = active(job);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [running, refresh]);

  async function send() {
    // ask while we still have the click; don't wait for the answer
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
    setBusy(true);
    setError("");
    const r = await fetch("/api/lessons/next", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course, note: note.trim() || undefined }),
    }).catch(() => null);
    setBusy(false);
    if (!r) return setError("Couldn't reach the app server.");
    const body = (await r.json().catch(() => ({}))) as { job?: LessonJob; error?: string };
    if (body.job) {
      setJob(body.job);
      setOpen(false);
      setNote("");
      window.dispatchEvent(new Event(JOB_STARTED));
    } else setError(body.error ?? `Request failed (${r.status}).`);
  }

  async function cancel() {
    if (!job) return;
    const r = await fetch("/api/lessons/cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ course, id: job.id }),
    }).catch(() => null);
    if (r?.ok) setJob(((await r.json()) as { job: LessonJob }).job);
  }

  if (!loaded) return null;

  let status: React.ReactNode = null;
  if (job && running)
    status = (
      <div className="nl-status" aria-live="polite">
        <p className="nl-line">
          <span className="nl-dot" aria-hidden />
          {job.status === "queued" ? "Starting…" : `Writing lesson… ${minutes(job)} min`}
        </p>
        {job.progress && <p className="nl-progress">{job.progress}</p>}
        <button type="button" className="nl-btn nl-quiet" onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  else if (job?.status === "done" && job.lesson)
    status = (
      <div className="nl-status">
        <p className="nl-line">
          Your new lesson is ready:{" "}
          <Link href={`/learn/${course}/${job.lesson.slug}`} className="nl-link">
            {job.lesson.title} →
          </Link>
        </p>
        {job.warning && <p className="nl-warn">{job.warning}</p>}
      </div>
    );
  else if (job?.status === "failed")
    status = (
      <div className="nl-status">
        <p className="nl-line nl-bad">The last lesson couldn’t be written: {job.error}</p>
      </div>
    );
  else if (job?.status === "cancelled")
    status = (
      <div className="nl-status">
        <p className="nl-line">The last request was cancelled.</p>
      </div>
    );

  return (
    <section className="nl" aria-label="Next lesson">
      {status}
      {!running &&
        (open ? (
          <div className="nl-form">
            <label htmlFor="nl-note">Anything for your teacher? (answers to ‘your turn’, what you want next)</label>
            <textarea id="nl-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
            <div className="nl-row">
              <button type="button" className="nl-btn" onClick={send} disabled={busy}>
                {busy ? "Sending…" : "Send"}
              </button>
              <button type="button" className="nl-btn nl-quiet" onClick={() => setOpen(false)}>
                Not now
              </button>
              <small>Runs in the background with Opus, up to $5. You’ll be told when it’s ready.</small>
            </div>
            {error && <p className="nl-bad">{error}</p>}
          </div>
        ) : (
          <button type="button" className="nl-btn" onClick={() => setOpen(true)}>
            {job?.status === "failed" ? "Try again" : "Ask for the next lesson"}
          </button>
        ))}
    </section>
  );
}
