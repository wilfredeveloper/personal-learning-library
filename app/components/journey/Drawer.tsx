"use client";

// One term's story, read-only: where it was opened, how deep it went, what was asked about it,
// and every later sign of whether it stuck ("Still clear?", "Recall first?", warm-ups).

import { useEffect, type ReactNode } from "react";
import type { Ev } from "@/lib/events";
import { when, type Standing, type TermState } from "./derive";

export const standingClass = (s: Standing) => (s === true ? "got" : s === false ? "notyet" : "open");
const standingWord = (s: Standing) => (s === true ? "got it" : s === false ? "not yet" : "not marked");

export function Dots({ n }: { n: number }) {
  return (
    <span className="jy-dots" aria-label={`depth ${n} of 4`}>
      {[1, 2, 3, 4].map((i) => (
        <i key={i} className={i <= n ? "on" : ""} />
      ))}
    </span>
  );
}

type Props = {
  t: TermState;
  terms: Map<string, TermState>;
  evs: Ev[];
  lessonTitle: (slug: string) => string;
  open: (term: string) => void;
  close: () => void;
};

export default function Drawer({ t, terms, evs, lessonTitle, open, close }: Props) {
  useEffect(() => {
    const onKey = (k: KeyboardEvent) => k.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const kids = [...terms.values()].filter((c) => c.from === t.term && c.term !== t.term);
  const termLink = (term: string) =>
    terms.has(term) ? <button onClick={() => open(term)}>{term}</button> : <>{term}</>;

  const story = (e: Ev): ReactNode => {
    switch (e.kind) {
      case "explore":
        return (
          <>
            {e.seenBefore ? "Opened again" : "Opened"} in § {e.section}
            {e.lesson !== t.lesson && <> ({lessonTitle(e.lesson)})</>}
            {e.from && <> from {termLink(e.from)}</>}
            {e.context && <q>{e.context}</q>}
          </>
        );
      case "deepen":
        return `Went to depth ${e.level}`;
      case "ask":
        return (
          <>
            Asked the tutor ({e.level}) <q>{e.text}</q>
          </>
        );
      case "clear":
        return e.v === null ? "Skipped “Still clear?”" : e.v ? "Said: still clear" : "Said: not clear yet";
      case "recall":
        return e.had === null ? "Opened its card again" : e.had ? "Recalled it before seeing the card" : "Couldn’t recall it before the card";
      case "quiz":
        return (
          <>
            Warm-up: {e.right ? "got it" : "missed it"} <q>{e.q}</q>
          </>
        );
      default:
        return null;
    }
  };

  return (
    <aside className="jy-drawer" aria-label={`Story of ${t.term}`}>
      <button className="jy-close" onClick={close} aria-label="Close">
        ✕
      </button>
      <header className={`jy-drawer-head ${standingClass(t.standing)}`}>
        <b>{t.term}</b>
        <Dots n={t.depth} />
        <span>{standingWord(t.standing)}</span>
      </header>
      <p className="jy-kicker">Its story</p>
      <ol className="jy-story">
        {t.events.map((i) => (
          <li key={i}>
            <time>{when(evs[i].t)}</time>
            <div>{story(evs[i])}</div>
          </li>
        ))}
      </ol>
      {kids.length > 0 && (
        <>
          <p className="jy-kicker">Led you to</p>
          {kids.map((k) => (
            <button key={k.term} className={`jy-chip ${standingClass(k.standing)}`} onClick={() => open(k.term)}>
              {k.term} <Dots n={k.depth} />
            </button>
          ))}
        </>
      )}
    </aside>
  );
}
