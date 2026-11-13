"use client";

// The tutor margin: an answer about one highlighted passage at a chosen depth, follow-ups,
// and the earlier questions on this lesson. Shared by the reader and the canvas; the view
// calls `ask` (through the ref) when the learner picks a depth on a highlight.

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type Ref } from "react";
import "katex/dist/katex.min.css";
import { markdownWithMath } from "@/lib/mathMarkdown";
import { useTutor, timeAgo, LEVEL_LABEL, type TutorLevel, type TutorThread } from "@/lib/tutor";
import { logEvent, type View } from "@/lib/events";

export type TutorAnchor = { selection: string; heading: string; context: string; level: TutorLevel };
export type TutorPanelHandle = { ask: (a: TutorAnchor) => void };
type Turn = { q: string; a: string };

/** Label stored for the automatic first question; not shown as a heading. */
export const FIRST_Q = "Explain this passage";

export function followUps(t: TutorThread): string {
  const n = Math.max(0, t.turns.length - 1);
  return n === 0 ? "No follow-ups" : n === 1 ? "1 follow-up" : `${n} follow-ups`;
}

export default function TutorPanel({
  ref,
  courseSlug,
  courseTitle,
  lessonSlug,
  lessonTitle,
  view: from,
  open,
  setOpen,
}: {
  ref?: Ref<TutorPanelHandle>;
  courseSlug: string;
  courseTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  view: View;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const [view, setView] = useState<"chat" | "history">("chat");
  const [anchor, setAnchor] = useState<TutorAnchor | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [streaming, setStreaming] = useState<Turn | null>(null);
  const [input, setInput] = useState("");
  const busy = streaming !== null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const threadId = useRef<string | null>(null);

  const { startThread, addTurn, deleteThread, threads } = useTutor();
  const lessonThreads = useMemo(
    () => threads.filter((t) => t.course === courseSlug && t.lesson === lessonSlug),
    [threads, courseSlug, lessonSlug],
  );

  const run = useCallback(
    async (question: string, a: TutorAnchor, history: Turn[], tid: string | null) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const label = question || FIRST_Q;
      setStreaming({ q: label, a: "" });
      logEvent(courseSlug, {
        kind: "ask",
        lesson: lessonSlug,
        view: from,
        term: a.selection || null,
        section: a.heading,
        text: label,
        level: a.level,
      });
      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            course: courseTitle,
            courseSlug, // for the call log; the title above goes into the prompt
            lesson: lessonTitle,
            heading: a.heading,
            selection: a.selection,
            context: a.context,
            level: a.level,
            question,
            history,
          }),
        });
        if (!res.body) throw new Error("No response stream");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let acc = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          setStreaming({ q: label, a: acc });
        }
        const answer = acc.trim();
        setTurns((t) => [...t, { q: label, a: answer }]);
        if (tid) addTurn(tid, { q: label, a: answer, at: Date.now() });
      } catch (e) {
        if ((e as Error).name !== "AbortError")
          setTurns((t) => [
            ...t,
            {
              q: label,
              a: `The tutor didn’t answer (${(e as Error).message}). Check that the \`claude\` CLI is signed in, then ask again.`,
            },
          ]);
      } finally {
        setStreaming(null);
      }
    },
    [courseSlug, courseTitle, lessonSlug, lessonTitle, addTurn, from],
  );

  // A new highlight starts a fresh thread.
  useImperativeHandle(
    ref,
    () => ({
      ask(a: TutorAnchor) {
        const id = startThread({
          course: courseSlug,
          courseTitle,
          lesson: lessonSlug,
          lessonTitle,
          selection: a.selection,
          heading: a.heading,
          context: a.context,
          level: a.level,
        });
        threadId.current = id;
        setAnchor(a);
        setTurns([]);
        setView("chat");
        setOpen(true);
        run("", a, [], id);
      },
    }),
    [run, startThread, setOpen, courseSlug, courseTitle, lessonSlug, lessonTitle],
  );

  // A first answer reads from the top (passage, then answer). A follow-up
  // brings its own question to the top of the margin; nothing chases the stream.
  const isLive = streaming !== null;
  useEffect(() => {
    if (!isLive) return;
    if (liveRef.current && turns.length > 0)
      liveRef.current.scrollIntoView({ block: "start", behavior: "smooth" });
    else scrollRef.current?.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive]);

  function submitFollowUp(e: React.FormEvent) {
    e.preventDefault();
    const q = input.trim();
    if (!q || !anchor || busy) return;
    setInput("");
    run(q, anchor, turns, threadId.current);
  }

  function openThread(t: TutorThread) {
    abortRef.current?.abort();
    setStreaming(null);
    threadId.current = t.id;
    setAnchor({
      selection: t.selection,
      heading: t.heading,
      context: t.context,
      level: t.level ?? "mid",
    });
    setTurns(t.turns.map((x) => ({ q: x.q, a: x.a })));
    setView("chat");
  }

  if (!open) return null;
  return (
    <aside className="rd-panel" aria-label="Tutor">
      <div className="rd-head">
        <h2>Tutor</h2>
        <div className="rd-tabs" role="tablist">
          <button className="rd-tab" role="tab" aria-selected={view === "chat"} onClick={() => setView("chat")}>
            This passage
          </button>
          <button className="rd-tab" role="tab" aria-selected={view === "history"} onClick={() => setView("history")}>
            Earlier{lessonThreads.length ? ` (${lessonThreads.length})` : ""}
          </button>
        </div>
        <button className="rd-close" onClick={() => setOpen(false)} aria-label="Close tutor">
          ✕
        </button>
      </div>

      {view === "history" ? (
        <div className="rd-scroll">
          {lessonThreads.length === 0 ? (
            <div className="rd-empty">
              <p className="rd-hint">Nothing asked on this lesson yet. Select a sentence in the lesson to start.</p>
            </div>
          ) : (
            <ul className="rd-threads">
              {lessonThreads.map((t) => (
                <li key={t.id} className="rd-thread">
                  <button className="rd-thread-open" onClick={() => openThread(t)}>
                    <p className="rd-excerpt">{t.selection}</p>
                  </button>
                  <div className="rd-thread-meta">
                    <span>{timeAgo(t.createdAt)}</span>
                    <span>{LEVEL_LABEL[t.level ?? "mid"]}</span>
                    <span>{followUps(t)}</span>
                    <button className="rd-remove" onClick={() => deleteThread(t.id)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <>
          <div ref={scrollRef} className="rd-scroll">
            {!anchor ? (
              <div className="rd-empty">
                <p>
                  Select any sentence in the lesson and pick a depth (Simple, Mid or Deep). The answer appears here,
                  written for that exact passage.
                </p>
                <p className="rd-hint">You can keep asking follow-ups about it afterwards.</p>
                {lessonThreads.length > 0 && (
                  <button className="rd-link" onClick={() => setView("history")}>
                    Reopen an earlier question
                  </button>
                )}
              </div>
            ) : (
              <>
                <p className="rd-label">You highlighted</p>
                <blockquote className="rd-quote">
                  <Quote text={anchor.selection} />
                </blockquote>
                <p className="rd-where">
                  {anchor.heading ? `In “${anchor.heading}” · ` : ""}
                  {LEVEL_LABEL[anchor.level]} explanation
                </p>

                {turns.map((t, i) => (
                  <Exchange key={i} turn={t} />
                ))}
                {streaming && (
                  <div ref={liveRef} className="rd-turn">
                    <Exchange turn={streaming} live bare />
                  </div>
                )}
              </>
            )}
          </div>

          {anchor && (
            <form onSubmit={submitFollowUp} className="rd-compose">
              <textarea
                className="rd-field"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) submitFollowUp(e);
                }}
                rows={1}
                aria-label="Follow-up question"
                placeholder="Ask a follow-up about this passage"
                disabled={busy}
              />
              <button type="submit" className="rd-send" disabled={busy || !input.trim()}>
                {busy ? "Answering" : "Ask"}
              </button>
            </form>
          )}
        </>
      )}
    </aside>
  );
}

/** The highlighted passage; maths highlighted on the canvas arrives as $TeX$ and is typeset. */
function Quote({ text }: { text: string }) {
  const html = useMemo(() => (text.includes("$") ? markdownWithMath(text).replace(/^<p>|<\/p>\s*$/g, "") : null), [text]);
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span>{text}</span>;
}

export function Exchange({ turn, live, bare }: { turn: Turn; live?: boolean; bare?: boolean }) {
  return (
    <div className={bare ? undefined : "rd-turn"}>
      {turn.q !== FIRST_Q && <p className="rd-q">{turn.q}</p>}
      {turn.a ? (
        <div
          className="rd-a"
          dangerouslySetInnerHTML={{
            __html: markdownWithMath(turn.a) + (live ? '<span class="rd-caret"></span>' : ""),
          }}
        />
      ) : (
        live && <p className="rd-wait">Reading the passage…</p>
      )}
    </div>
  );
}
