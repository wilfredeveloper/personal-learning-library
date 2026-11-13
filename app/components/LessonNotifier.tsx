"use client";

// Mounted once in the root layout. Watches lesson jobs (app/api/lessons/jobs): once on load,
// then every 20 s while any job is queued or running, and right away when NextLesson starts one.
// When a job it saw active finishes, it shows a banner on whatever page is open and, if the
// browser allows, a system notification. Ids it has seen active / already announced are kept in
// localStorage, so a job that finishes while the app is closed is announced on the next visit,
// and nothing is announced twice.

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { LessonJob } from "@/lib/lessonJobs";
import "@/app/lessons.css";

export const JOB_STARTED = "lesson-job-started"; // window event fired by NextLesson

const POLL_MS = 20_000;
const KEY = "learn.lessonJobs.v1";
const KEEP = 50;

type Memory = { seen: string[]; notified: string[] };
const recall = (): Memory => {
  try {
    const m = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (m && Array.isArray(m.seen) && Array.isArray(m.notified)) return m;
  } catch {}
  return { seen: [], notified: [] };
};
const remember = (m: Memory) => {
  try {
    localStorage.setItem(KEY, JSON.stringify({ seen: m.seen.slice(-KEEP), notified: m.notified.slice(-KEEP) }));
  } catch {}
};

const active = (j: LessonJob) => j.status === "queued" || j.status === "running";
const hrefOf = (j: LessonJob) => (j.status === "done" && j.lesson ? `/learn/${j.course}/${j.lesson.slug}` : `/learn/${j.course}`);

export default function LessonNotifier() {
  const [banners, setBanners] = useState<LessonJob[]>([]);
  const router = useRouter();

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let dead = false;

    const check = async () => {
      clearTimeout(timer);
      const r = await fetch("/api/lessons/jobs").catch(() => null);
      if (dead) return;
      const jobs = r?.ok ? ((await r.json()) as { jobs: LessonJob[] }).jobs : null;
      if (!jobs) return; // server down or not local: stay quiet, try again on the next start event
      const m = recall();
      const fresh: LessonJob[] = [];
      for (const j of jobs) {
        if (active(j)) {
          if (!m.seen.includes(j.id)) m.seen.push(j.id);
        } else if ((j.status === "done" || j.status === "failed") && m.seen.includes(j.id) && !m.notified.includes(j.id)) {
          m.notified.push(j.id);
          fresh.push(j);
        }
      }
      remember(m);
      if (fresh.length) {
        setBanners((b) => [...b, ...fresh]);
        for (const j of fresh) notify(j);
      }
      if (jobs.some(active)) timer = setTimeout(check, POLL_MS);
    };

    const notify = (j: LessonJob) => {
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
      try {
        const n =
          j.status === "done"
            ? new Notification("Your next lesson is ready", { body: j.lesson?.title, tag: j.id })
            : new Notification("The next lesson couldn’t be written", { body: j.error, tag: j.id });
        n.onclick = () => {
          window.focus();
          router.push(hrefOf(j));
          n.close();
        };
      } catch {
        /* some browsers only allow notifications from a service worker */
      }
    };

    check();
    window.addEventListener(JOB_STARTED, check);
    return () => {
      dead = true;
      clearTimeout(timer);
      window.removeEventListener(JOB_STARTED, check);
    };
  }, [router]);

  if (!banners.length) return null;
  const dismiss = (id: string) => setBanners((b) => b.filter((j) => j.id !== id));
  return (
    <div className="ln-stack" role="status" aria-live="polite">
      {banners.map((j) => (
        <div key={j.id} className={`ln-banner${j.status === "failed" ? " ln-failed" : ""}`}>
          {j.status === "done" ? (
            <p>
              Your next lesson, <b>{j.lesson?.title}</b>, is ready{" "}
              <Link href={hrefOf(j)} onClick={() => dismiss(j.id)}>
                → Open
              </Link>
            </p>
          ) : (
            <p>
              The next lesson for <b>{j.course}</b> couldn’t be written: {j.error}{" "}
              <Link href={hrefOf(j)} onClick={() => dismiss(j.id)}>
                → Course
              </Link>
            </p>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(j.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
