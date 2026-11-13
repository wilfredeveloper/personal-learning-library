"use client";

// The Journey page: a look back at a course, never a to-do list. One block per lesson, its
// sections as rows; each row has the minutes read per session and the trails of terms that
// started there. One replay slider drives everything. Read-only: the asks live in the lesson.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Ev } from "@/lib/events";
import {
  describe,
  firstTry,
  lessonBlocks,
  notes,
  readingAt,
  sectionKey,
  sessionIndexOf,
  sessionLabel,
  sessions,
  sortEvents,
  standingCounts,
  termsAt,
  trails,
  when,
  type LessonOutline,
  type TermState,
} from "./derive";
import Drawer, { standingClass } from "./Drawer";

const MAX_COLS = 8; // heat columns: the last this many sessions

type Props = { course: string; courseTitle: string; outline: LessonOutline[] };

export default function Journey({ course, courseTitle, outline }: Props) {
  const [evs, setEvs] = useState<Ev[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/events?course=${encodeURIComponent(course)}`)
      .then((r) => (r.ok ? r.json() : r.status === 404 ? [] : Promise.reject(new Error(String(r.status)))))
      .then((data: Ev[]) => live && setEvs(sortEvents(Array.isArray(data) ? data : [])))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [course]);

  const first = outline[0];
  return (
    <div className="lib-breakout jy">
      <div className="lib">
        <header className="lib-titlebar jy-head">
          <div>
            <Link href={`/learn/${course}`} className="back-link">
              ← {courseTitle}
            </Link>
            <p className="lib-eyebrow">Journey</p>
            <h1>{courseTitle}</h1>
          </div>
          <p>A look back at what you read, opened and asked. Nothing here needs doing.</p>
        </header>
        {failed ? (
          <p className="jy-empty">Couldn’t read this course’s log.</p>
        ) : evs === null ? (
          <p className="jy-empty">Loading…</p>
        ) : evs.length === 0 ? (
          <p className="jy-empty">
            Nothing recorded for this course yet.{" "}
            {first && <Link href={`/learn/${course}/${first.slug}`}>Start with lesson 1: {first.title} →</Link>}
          </p>
        ) : (
          <Rows evs={evs} outline={outline} />
        )}
      </div>
    </div>
  );
}

function Rows({ evs, outline }: { evs: Ev[]; outline: LessonOutline[] }) {
  const N = evs.length;
  const [cut, setCut] = useState(N);
  const [playing, setPlaying] = useState(false);
  const [openTerm, setOpenTerm] = useState<string | null>(null);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setCut((c) => (c >= N ? (setPlaying(false), c) : c + 1)), 220);
    return () => clearInterval(id);
  }, [playing, N]);

  // Fixed for the whole log: the layout doesn't move while replaying.
  const ss = useMemo(() => sessions(evs), [evs]);
  const all = useMemo(() => termsAt(evs), [evs]);
  const tree = useMemo(() => trails(all), [all]);
  const blocks = useMemo(() => lessonBlocks(outline, evs), [outline, evs]);
  const lessonTitle = useMemo(() => new Map(blocks.map((b) => [b.slug, b.title])), [blocks]);

  // As of the replay position.
  const now = useMemo(() => termsAt(evs, cut), [evs, cut]);
  const reading = useMemo(() => readingAt(evs, ss, cut), [evs, ss, cut]);
  const counts = standingCounts(now);
  const quiz = firstTry(evs, cut);
  const words = notes(evs, cut);

  const shown = ss.length > MAX_COLS ? ss.length - MAX_COLS : 0; // first session index with a column
  const cols = {
    gridTemplateColumns: `230px repeat(${ss.length - shown}, 58px) minmax(0, 1fr)`,
  };
  const replaying = cut < N;
  const e = evs[cut - 1];
  const curSession = sessionIndexOf(ss, cut - 1);
  const focus = "term" in e ? e.term : null;
  // the row to light up: where the current term's trail lives, or the event's own section
  const curKey = focus && tree.home.has(focus) ? tree.home.get(focus) : "section" in e ? sectionKey(e.lesson, e.section) : undefined;

  const total = (key: string) => (reading.get(key) ?? []).reduce((a, b) => a + b, 0);
  let longest: { lesson: string; section: string; secs: number } | null = null;
  for (const b of blocks)
    for (const s of b.sections) {
      const secs = total(sectionKey(b.slug, s));
      if (secs > 0 && (!longest || secs > longest.secs)) longest = { lesson: b.slug, section: s, secs };
    }
  const heatMax = Math.max(1, ...[...reading.values()].flat());
  const past = evs.slice(0, cut);

  return (
    <>
      <div className="jy-top">
        <div className="jy-scrub">
          <button
            onClick={() => {
              if (cut >= N) setCut(1);
              setPlaying(!playing);
            }}
          >
            {playing ? "Pause" : "▶ Replay"}
          </button>
          <input
            type="range"
            min={1}
            max={N}
            value={cut}
            onChange={(ev) => {
              setPlaying(false);
              setCut(+ev.target.value);
            }}
            aria-label="Point in time"
          />
          <span>
            <b>{when(e.t)}</b> · {describe(e)}
          </span>
        </div>
        {words.length > 0 && (
          <p className="jy-words">
            In your words:{" "}
            {words.map((w) => (
              <q key={w.i}>
                {w.text} <small>{when(evs[w.i].t)}</small>
              </q>
            ))}
          </p>
        )}
        <div className="jy-said">
          <p>
            Longest on <b>§ {longest?.section ?? "—"}</b>
            {longest && ` (${Math.round(longest.secs / 60)} min)`}
            {longest && blocks.length > 1 && <small> in {lessonTitle.get(longest.lesson)}</small>}.
          </p>
          <p>
            <b>{counts.opened}</b> terms opened · <span className="jy-g">{counts.got} got</span> ·{" "}
            <span className="jy-n">{counts.notYet} not yet</span>
          </p>
          <p>
            Quizzes{" "}
            <b>
              {quiz.right}/{quiz.total}
            </b>{" "}
            on the first try.
          </p>
        </div>
      </div>

      <p className="jy-sessions">
        {ss.length} {ss.length === 1 ? "session" : "sessions"}
        {shown > 0 && ` · squares show the last ${MAX_COLS}`}
      </p>

      {blocks.map((b) => (
        <section key={b.slug} className="jy-lesson">
          <div className="jy-head-row" style={cols}>
            <span>
              {b.number ? `Lesson ${b.number} · ` : ""}
              {b.title}
            </span>
            {ss.slice(shown).map((s, j) => {
              const [day, time] = sessionLabel(evs[s.start].t);
              return (
                <span key={j} className={`jy-col${replaying && shown + j === curSession ? " now" : ""}`}>
                  {day}
                  <small>{time}</small>
                </span>
              );
            })}
            <span>Trails of terms, from where they started</span>
          </div>
          {b.sections.map((sec) => {
            const key = sectionKey(b.slug, sec);
            const per = reading.get(key) ?? [];
            const nodes = tree.bySection.get(key) ?? [];
            const h = Math.max(58, 16 + nodes.length * 46);
            const w = 40 + Math.max(0, ...nodes.map((n) => n.depth)) * 190 + 220; // drawn at 1:1, room for the last label
            const pos = new Map(nodes.map((n) => [n.term, { x: 40 + n.depth * 190, y: 38 + n.row * 46 }]));
            return (
              <div key={sec} className={`jy-row${replaying && curKey === key ? " now" : ""}`} style={cols}>
                <div className="jy-secname">
                  § {sec}
                  <span className="jy-meta">
                    {total(key) > 0 && total(key) < 30 ? "<1" : Math.round(total(key) / 60)} min
                    {past.map((ev, i) =>
                      ev.lesson !== b.slug ? null : ev.kind === "quiz" && !ev.fromGap && ev.section === sec ? (
                        <span key={i} className={`jy-tick ${ev.right ? "ok" : "no"}`} title={ev.q}>
                          {ev.right ? "✓" : "✗"}
                        </span>
                      ) : ev.kind === "lab" && ev.section === sec && ev.goal ? (
                        <span key={i} className="jy-tick ok" title={ev.detail}>
                          ◎
                        </span>
                      ) : null,
                    )}
                  </span>
                </div>
                {ss.slice(shown).map((_, j) => {
                  const secs = per[shown + j] ?? 0;
                  return (
                    <span key={j} className="jy-col">
                      <span
                        className="jy-heat"
                        style={{
                          opacity: secs ? 0.15 + Math.min(1, secs / heatMax) * 0.85 : 0.06,
                        }}
                        title={`${Math.round(secs / 60)} min`}
                      >
                        {secs ? (secs < 30 ? "<1" : Math.round(secs / 60)) : ""}
                      </span>
                    </span>
                  );
                })}
                {nodes.length > 0 ? (
                  <div className="jy-map-wrap">
                    <svg
                      viewBox={`0 0 ${w} ${h}`}
                      className="jy-map"
                      style={{ width: w, height: h }}
                      role="img"
                      aria-label={`Terms opened from § ${sec}`}
                    >
                      {nodes.map((n) => {
                        const p = pos.get(n.term)!;
                        const a = n.parent ? pos.get(n.parent)! : { x: 0, y: p.y };
                        const m = Math.max(20, (p.x - a.x) / 2);
                        return (
                          <path
                            key={n.term}
                            d={`M${a.x} ${a.y} C${a.x + m} ${a.y}, ${p.x - m} ${p.y}, ${p.x} ${p.y}`}
                            className={`jy-edge${n.parent ? "" : " root"}${now.has(n.term) ? "" : " jy-hidden"}`}
                          />
                        );
                      })}
                      {nodes.map((n) => {
                        const p = pos.get(n.term)!;
                        const t = now.get(n.term);
                        return (
                          <g
                            key={n.term}
                            className={`jy-node ${standingClass(t?.standing ?? null)}${t ? "" : " jy-hidden"}${focus === n.term ? " focus" : ""}`}
                            transform={`translate(${p.x} ${p.y})`}
                            onClick={() => setOpenTerm(n.term)}
                            role="button"
                            tabIndex={t ? 0 : -1}
                            onKeyDown={(k) => (k.key === "Enter" || k.key === " ") && setOpenTerm(n.term)}
                          >
                            <circle r={5 + (t?.depth ?? 1) * 2.5} />
                            <text x={-8} y={-16}>
                              {n.term}
                              {t && t.asks > 0 ? " ?" : ""}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                ) : (
                  <span />
                )}
              </div>
            );
          })}
        </section>
      ))}
      <p className="jy-legend">
        <i className="got" /> got it <i className="notyet" /> not yet <i className="open" /> not marked · size = depth reached · ? = asked
        the tutor · squares = minutes read per session · click a term for its story
      </p>
      {openTerm && all.get(openTerm) && (
        <Drawer
          t={all.get(openTerm) as TermState}
          terms={all}
          evs={evs}
          lessonTitle={(slug) => lessonTitle.get(slug) ?? slug}
          open={setOpenTerm}
          close={() => setOpenTerm(null)}
        />
      )}
    </>
  );
}
