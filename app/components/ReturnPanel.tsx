"use client";

// "From last time": the "Still clear?" taps and the warm-up questions generated from the
// learner's gaps (docs/journey/SCOPE.md, WP6), shown when a lesson opens. Small, never in
// the way: it can be collapsed or skipped, and once everything in it is answered or skipped
// it stays closed for this course until tomorrow.
// Mounted inside the canvas viewport and the reader body; it positions itself.

import { useEffect, useRef, useState } from "react";
import { logEvent } from "@/lib/events";
import "@/app/asks.css";

export type LessonPlace = { courseSlug: string; courseTitle: string; lessonSlug: string; lessonTitle: string; view: "canvas" | "reader" };

type Question = { id: string; gap: string; term: string | null; q: string; options: string[]; answer: number };
type Ev = { t: string; kind: string; term?: string | null; level?: number };
// What this course's panel has done today, kept in localStorage so a reload or the next lesson picks up from here.
type Day = { closed?: boolean; clearTerms?: string[]; clear?: Record<string, boolean>; picked?: Record<string, number> };

const DAY_MS = 24 * 60 * 60 * 1000;
const AWAY = 2 * DAY_MS; // "Still clear?" only after this long without any event in the course
const SESSION_GAP = 45 * 60 * 1000;
const SECTION = "From last time";
const CLOSE_AFTER = 2500; // ms to see the last answer graded before the panel goes

const norm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
function localDate() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const keyOf = (course: string) => `asks:${course}:${localDate()}`;
function loadDay(course: string): Day {
  try {
    return JSON.parse(localStorage.getItem(keyOf(course)) ?? "{}") ?? {};
  } catch {
    return {};
  }
}
function saveDay(course: string, d: Day) {
  try {
    localStorage.setItem(keyOf(course), JSON.stringify(d));
  } catch {
    /* storage blocked: the panel just comes back on the next open */
  }
}

// Up to 3 terms from the last session, those deepened to level 3+ or asked about first.
function lastSessionTerms(evs: Ev[]): string[] {
  const s = [...evs].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  let i = s.length - 1;
  while (i > 0 && Date.parse(s[i].t) - Date.parse(s[i - 1].t) <= SESSION_GAP) i--;
  const sess = s.slice(i).reverse(); // newest first
  const strong = new Set<string>();
  const all = new Map<string, string>(); // key -> term as written
  for (const e of sess) {
    if (!e.term || !["explore", "deepen", "ask"].includes(e.kind)) continue;
    const k = norm(e.term);
    if (!all.has(k)) all.set(k, e.term.trim());
    if (e.kind === "ask" || (e.kind === "deepen" && (e.level ?? 0) >= 3)) strong.add(k);
  }
  const keys = [...all.keys()];
  return [...keys.filter((k) => strong.has(k)), ...keys.filter((k) => !strong.has(k))].slice(0, 3).map((k) => all.get(k)!);
}

export default function ReturnPanel({ courseSlug, lessonSlug, view }: LessonPlace) {
  const [day, setDay] = useState<Day | null>(null); // null until read on the client
  const [away, setAway] = useState(0); // days since the last session, when "Still clear?" is shown
  const [questions, setQuestions] = useState<Question[]>([]);
  const [warmSettled, setWarmSettled] = useState(false);
  const [open, setOpen] = useState(true);
  const [gone, setGone] = useState(false);
  const rootRef = useRef<HTMLElement>(null);

  // Read today's state, decide on "Still clear?" from the log, and fetch the warm-up in the background.
  useEffect(() => {
    let dead = false;
    const opened = Date.now();
    const d = loadDay(courseSlug);
    if (d.closed) return; // done for today: `day` stays null and nothing renders
    fetch(`/api/events?course=${courseSlug}`)
      .then((r) => (r.ok ? r.json() : []), () => [])
      .then((evs: Ev[]) => {
        if (dead) return;
        const before = (Array.isArray(evs) ? evs : []).filter((e) => typeof e?.t === "string" && Date.parse(e.t) < opened);
        if (!before.length) {
          setDay(d); // a course with no history: nothing to ask, and no warm-up call
          setWarmSettled(true);
          return;
        }
        const last = Math.max(...before.map((e) => Date.parse(e.t)));
        if (!d.clearTerms && opened - last >= AWAY) {
          d.clearTerms = lastSessionTerms(before);
          setAway(Math.floor((opened - last) / DAY_MS));
          saveDay(courseSlug, d);
        }
        setDay(d);
        fetch(`/api/warmup?course=${courseSlug}&lesson=${lessonSlug}`)
          .then((r) => (r.ok ? r.json() : null), () => null)
          .then((w: { questions?: Question[] } | null) => {
            if (dead) return;
            if (Array.isArray(w?.questions)) setQuestions(w.questions);
            setWarmSettled(true);
          });
      });
    return () => {
      dead = true;
    };
  }, [courseSlug, lessonSlug]);

  // The canvas pans on pointerdown and moves on wheel (a native listener on the viewport),
  // so neither may leave the panel. Native listeners run before the event reaches it.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("pointerdown", stop);
    el.addEventListener("wheel", stop, { passive: true });
    return () => {
      el.removeEventListener("pointerdown", stop);
      el.removeEventListener("wheel", stop);
    };
  });

  const update = (fn: (d: Day) => Day) =>
    setDay((d) => {
      const next = fn(d ?? {});
      saveDay(courseSlug, next);
      return next;
    });

  const terms = day?.clearTerms ?? [];
  const clear = day?.clear ?? {};
  const picked = day?.picked ?? {};
  const clearDone = terms.every((t) => clear[t] !== undefined);
  const warm = questions.filter((q) => q.options.length === 3);
  const warmDone = warm.every((q) => picked[q.id] !== undefined);
  const finished = day !== null && !day.closed && warmSettled && clearDone && warmDone && (terms.length > 0 || warm.length > 0);

  // Everything shown is answered: let the last grade show, then close for today.
  useEffect(() => {
    if (!finished) return;
    const t = setTimeout(() => {
      update((d) => ({ ...d, closed: true }));
      setGone(true);
    }, CLOSE_AFTER);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  function tapClear(term: string, v: boolean) {
    if (clear[term] !== undefined) return;
    logEvent(courseSlug, { kind: "clear", lesson: lessonSlug, view, term, v });
    update((d) => ({ ...d, clear: { ...d.clear, [term]: v } }));
  }
  function pick(q: Question, i: number) {
    if (picked[q.id] !== undefined) return;
    logEvent(courseSlug, { kind: "quiz", lesson: lessonSlug, view, section: SECTION, q: q.q, right: i === q.answer, first: true, fromGap: true, term: q.term });
    update((d) => ({ ...d, picked: { ...d.picked, [q.id]: i } }));
  }
  function skip() {
    for (const term of terms) if (clear[term] === undefined) logEvent(courseSlug, { kind: "clear", lesson: lessonSlug, view, term, v: null });
    update((d) => ({ ...d, closed: true }));
    setGone(true);
  }

  if (gone || !day || day.closed) return null;
  const showClear = terms.length > 0 && !clearDone;
  const showLine = terms.length > 0 && clearDone;
  const showWarm = clearDone && warm.length > 0;
  const notYet = terms.filter((t) => clear[t] === false).length;
  if (!showClear && !showLine && !showWarm) return null;

  const left = terms.filter((t) => clear[t] === undefined).length + warm.filter((q) => picked[q.id] === undefined).length;

  return (
    <section ref={rootRef} className={`ask-panel ask-${view}`} aria-label="From last time">
      <header>
        <button className="ask-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          <span className="ask-dot" aria-hidden="true" />
          From last time
          {!open && left > 0 && <small>{left} left</small>}
        </button>
        <button className="ask-skip" onClick={skip}>
          Skip
        </button>
      </header>

      {open && (
        <div className="ask-body">
          {showClear && (
            <div className="ask-clear">
              <p className="ask-lead">
                {away >= 2 ? `${away} days since your last session. ` : ""}
                <b>Still clear?</b>
              </p>
              <ul>
                {terms.map((t) => (
                  <li key={t}>
                    <span>{t}</span>
                    <button className={clear[t] === true ? "on yes" : ""} disabled={clear[t] !== undefined} onClick={() => tapClear(t, true)}>
                      Yes
                    </button>
                    <button className={clear[t] === false ? "on no" : ""} disabled={clear[t] !== undefined} onClick={() => tapClear(t, false)}>
                      Not yet
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {showLine && (
            <p className="ask-line">
              {notYet
                ? `${notYet} “not yet”: ${notYet === 1 ? "it comes" : "they come"} back in a warm-up.`
                : "All still clear."}
              {!warmSettled && " Warm-up on its way…"}
            </p>
          )}

          {showWarm && (
            <div className="ask-warm">
              <p className="ask-kicker">Warm-up</p>
              {warm.map((q) => {
                const p = picked[q.id];
                return (
                  <div key={q.id} className="ask-q">
                    <p>{q.q}</p>
                    <div role="group" aria-label="Options">
                      {q.options.map((o, i) => (
                        <button
                          key={i}
                          disabled={p !== undefined}
                          onClick={() => pick(q, i)}
                          className={p === undefined ? "" : i === q.answer ? "right" : p === i ? "wrong" : "dim"}
                        >
                          {o}
                        </button>
                      ))}
                    </div>
                    {p !== undefined && <small className={p === q.answer ? "ask-ok" : "ask-no"}>{p === q.answer ? "Right." : "Not quite: the green one."}</small>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
