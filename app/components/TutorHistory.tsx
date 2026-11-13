"use client";

import Link from "next/link";
import { useState } from "react";
import { useTutor, timeAgo, LEVEL_LABEL, type TutorThread } from "@/lib/tutor";
import { useHasMounted } from "@/lib/store";
import { Exchange, followUps } from "@/components/TutorPanel";

type LessonGroup = { title: string; slug: string; course: string; threads: TutorThread[] };

export default function TutorHistory() {
  const mounted = useHasMounted();
  const threads = useTutor((s) => s.threads);
  const deleteThread = useTutor((s) => s.deleteThread);
  const clearAll = useTutor((s) => s.clearAll);

  if (!mounted) return null;

  // Group by course -> lesson, preserving recency (threads are newest-first).
  const byCourse = new Map<string, { title: string; lessons: Map<string, LessonGroup> }>();
  for (const t of threads) {
    if (!byCourse.has(t.course)) byCourse.set(t.course, { title: t.courseTitle, lessons: new Map() });
    const c = byCourse.get(t.course)!;
    if (!c.lessons.has(t.lesson))
      c.lessons.set(t.lesson, { title: t.lessonTitle, slug: t.lesson, course: t.course, threads: [] });
    c.lessons.get(t.lesson)!.threads.push(t);
  }

  const total = threads.length;

  return (
    <div className="lib-breakout">
      <div className="lib">
        <header className="lib-titlebar">
          <div>
            <Link href="/learn" className="back-link">
              ← Library
            </Link>
            <h1>Questions</h1>
          </div>
          <p>
            Every passage you highlighted, with the tutor&apos;s answers and your follow-ups. Saved
            in this browser only.
          </p>
        </header>

        <div className="section-label">
          <p>Asked so far</p>
          <span>
            {total} {total === 1 ? "passage" : "passages"}
          </span>
        </div>

        <div className="rd-history">
          {total === 0 ? (
            <div className="rd-empty">
              <p>Nothing asked yet.</p>
              <p className="rd-hint">
                Open a lesson, select a sentence and choose “Ask the tutor”. Each passage you ask
                about is kept here.
              </p>
            </div>
          ) : (
            <>
              {[...byCourse.entries()].map(([courseSlug, course]) => (
                <section key={courseSlug}>
                  <h2>{course.title}</h2>
                  {[...course.lessons.values()].map((lesson) => (
                    <div key={lesson.slug}>
                      <h3>
                        <Link href={`/learn/${lesson.course}/${lesson.slug}/reader`}>{lesson.title}</Link>
                      </h3>
                      <ul className="rd-threads">
                        {lesson.threads.map((t) => (
                          <ThreadEntry key={t.id} thread={t} onDelete={() => deleteThread(t.id)} />
                        ))}
                      </ul>
                    </div>
                  ))}
                </section>
              ))}
              <p style={{ marginTop: 40 }}>
                <button
                  className="rd-remove"
                  style={{ fontSize: "0.8rem" }}
                  onClick={() => confirm("Remove every saved question?") && clearAll()}
                >
                  Remove all questions
                </button>
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function ThreadEntry({ thread, onDelete }: { thread: TutorThread; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <li className="rd-thread">
      <button className="rd-thread-open" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? (
          <blockquote className="rd-quote">
            <span>{thread.selection}</span>
          </blockquote>
        ) : (
          <p className="rd-excerpt">{thread.selection}</p>
        )}
      </button>
      {open && (
        <div className="rd-thread-body">
          {thread.turns.map((turn, i) => (
            <Exchange key={i} turn={turn} />
          ))}
        </div>
      )}
      <div className="rd-thread-meta">
        <span>{timeAgo(thread.createdAt)}</span>
        <span>{LEVEL_LABEL[thread.level ?? "mid"]}</span>
        <span>{followUps(thread)}</span>
        <button className="rd-remove" onClick={onDelete}>
          Remove
        </button>
      </div>
    </li>
  );
}
