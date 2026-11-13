"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { LEVEL_LABEL, type TutorLevel } from "@/lib/tutor";
import { useDwell, useLessonMessages } from "@/lib/events";
import ReturnPanel from "@/components/ReturnPanel";
import SessionEnd from "@/components/SessionEnd";
import TutorPanel, { type TutorPanelHandle } from "@/components/TutorPanel";

type NavLink = { slug: string; title: string } | null;

/** The lesson section being read: the last h2 above the middle of the frame's visible part.
 *  Works whether the frame scrolls itself (the reader) or the page scrolls a tall frame.
 *  Above the first h2 it is the lesson's h1, as the tutor bridge names it. */
function sectionInFrame(frame: HTMLIFrameElement | null): string | null {
  const doc = frame?.contentDocument;
  if (!frame || !doc || doc.location.href === "about:blank") return null;
  const box = frame.getBoundingClientRect();
  const top = Math.max(0, -box.top);
  const bottom = Math.min(box.height, window.innerHeight - box.top);
  if (bottom <= top) return null; // frame scrolled out of view
  const mid = (top + bottom) / 2; // in the frame's own viewport coordinates
  let name = doc.querySelector("h1")?.innerText.trim() ?? null;
  for (const h of doc.querySelectorAll("h2")) {
    if (h.getBoundingClientRect().top > mid) break;
    name = h.innerText.trim();
  }
  return name;
}

export default function LessonReader({
  courseSlug,
  courseTitle,
  lessonSlug,
  lessonTitle,
  src,
  prev,
  next,
}: {
  courseSlug: string;
  courseTitle: string;
  lessonSlug: string;
  lessonTitle: string;
  src: string;
  prev: NavLink;
  next: NavLink;
}) {
  const [open, setOpen] = useState(false);
  const tutor = useRef<TutorPanelHandle>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  useDwell(courseSlug, lessonSlug, "reader", () => sectionInFrame(frameRef.current));
  useLessonMessages(courseSlug, lessonSlug, "reader", frameRef);

  // New highlight from the lesson iframe (ask-bridge.js) -> start a fresh thread.
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type !== "ask-claude") return;
      tutor.current?.ask({
        selection: e.data.selection ?? "",
        heading: e.data.heading ?? "",
        context: e.data.context ?? "",
        level: e.data.level in LEVEL_LABEL ? (e.data.level as TutorLevel) : "mid",
      });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div className="rd">
      <header className="rd-bar">
        <Link href={`/learn/${courseSlug}`} className="rd-bar-course">
          ← {courseTitle}
        </Link>
        <span className="rd-bar-title">{lessonTitle}</span>
        <div className="rd-bar-nav">
          {prev && <Link href={`/learn/${courseSlug}/${prev.slug}/reader`}>Previous</Link>}
          {next && <Link href={`/learn/${courseSlug}/${next.slug}/reader`}>Next</Link>}
          <Link href={`/learn/${courseSlug}/${lessonSlug}`}>Canvas</Link>
          <SessionEnd courseSlug={courseSlug} courseTitle={courseTitle} lessonSlug={lessonSlug} lessonTitle={lessonTitle} view="reader" />
          <button className="rd-toggle" aria-pressed={open} onClick={() => setOpen((o) => !o)}>
            Tutor
          </button>
        </div>
      </header>

      <div className="rd-body">
        <iframe ref={frameRef} key={src} src={src} title={lessonTitle} className="rd-frame" />
        <ReturnPanel courseSlug={courseSlug} courseTitle={courseTitle} lessonSlug={lessonSlug} lessonTitle={lessonTitle} view="reader" />

        <TutorPanel
          ref={tutor}
          courseSlug={courseSlug}
          courseTitle={courseTitle}
          lessonSlug={lessonSlug}
          lessonTitle={lessonTitle}
          view="reader"
          open={open}
          setOpen={setOpen}
        />
      </div>
    </div>
  );
}
