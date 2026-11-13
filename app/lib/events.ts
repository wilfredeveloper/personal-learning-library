import { useEffect, useRef, type RefObject } from "react";

// Study events: what the learner did, appended to learning/<course>/app-data/events.jsonl
// by /api/events. The teacher reads the log to plan the next lesson; the learner never
// has to. Logging is fire-and-forget: it batches, never throws, and does nothing on the server.

export type View = "canvas" | "reader" | "session";
type Base = { t: string; lesson: string; view: View };
export type Ev = Base & (
  | { kind: "read"; section: string; secs: number }
  | { kind: "explore"; term: string; from: string | null; section: string; context: string; card: string; seenBefore: boolean; level?: number } // level: depth the card opened at (absent = 1)
  | { kind: "deepen"; card: string; term: string; level: 1 | 2 | 3 | 4 }
  | { kind: "ask"; term: string | null; section: string; text: string; level: "simple" | "mid" | "deep" }
  | { kind: "quiz"; section: string; q: string; right: boolean; first: boolean; fromGap: boolean; term?: string | null } // term: the gap a warm-up question tests (null = a section gap)
  | { kind: "lab"; section: string; lab: string; goal: boolean; detail: string }
  | { kind: "done"; done: boolean }
  // Phase 2 asks
  | { kind: "clear"; term: string; v: boolean | null } // "Still clear?" on return; null = skipped
  | { kind: "recall"; term: string; card: string; had: boolean | null } // "Recall first?"; null = skipped
  | { kind: "note"; text: string } // end-of-session line
);

// Ev without `t` (logEvent stamps it). Distributes over the union so each kind keeps its fields.
type WithoutT<E> = E extends unknown ? Omit<E, "t"> : never;
export type EvInput = WithoutT<Ev>;

const MAX = 200; // the route accepts at most this many per request
const queue = new Map<string, Ev[]>(); // course -> pending events
let timer: ReturnType<typeof setInterval> | null = null;

function send(course: string, events: Ev[]) {
  const body = JSON.stringify({ course, events });
  try {
    // sendBeacon survives the page going away; fall back to a keepalive fetch if it refuses.
    if (navigator.sendBeacon?.("/api/events", new Blob([body], { type: "application/json" }))) return;
    fetch("/api/events", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }).catch(() => {});
  } catch {
    /* logging must never break the page */
  }
}

function flush() {
  for (const [course, events] of queue) {
    queue.delete(course);
    for (let i = 0; i < events.length; i += MAX) send(course, events.slice(i, i + MAX));
  }
}

export function logEvent(course: string, ev: EvInput) {
  if (typeof window === "undefined") return;
  try {
    const list = queue.get(course) ?? [];
    list.push({ ...ev, t: new Date().toISOString() } as Ev);
    queue.set(course, list);
    if (!timer) {
      timer = setInterval(flush, 2000);
      window.addEventListener("pagehide", flush);
    }
  } catch {
    /* never throw into the caller */
  }
}

// Reading time per section, logged as `read` events. Time counts only while the tab is
// visible and the learner touched something recently, so an open tab left alone adds
// nothing. getSection names the section in view, or null to not count this tick.
const DWELL_TICK = 5; // seconds per sample
const DWELL_CAP = 60; // flush a section once it holds this many seconds
const DWELL_IDLE = 60_000; // ms without input before reading time stops counting
const INPUT_EVENTS = ["pointerdown", "pointermove", "wheel", "keydown", "scroll"] as const;
const INPUT_OPTS = { capture: true, passive: true }; // capture: scroll does not bubble

export function useDwell(course: string, lesson: string, view: View, getSection: () => string | null): void {
  // Callers pass a fresh closure each render; the interval reads the latest one.
  const getRef = useRef(getSection);
  useEffect(() => {
    getRef.current = getSection;
  });

  useEffect(() => {
    let lastInput = Date.now(); // opening the lesson counts as input
    let section: string | null = null;
    let secs = 0;

    const save = () => {
      if (section !== null && secs > 0) logEvent(course, { kind: "read", lesson, view, section, secs });
      secs = 0;
    };
    const onInput = () => {
      lastInput = Date.now();
    };

    // Lessons render in same-origin iframes, whose input never reaches this window,
    // so listen inside each frame's document too. A navigation replaces the document,
    // hence attaching again on every load.
    const docs: Document[] = [];
    const frames = new Set<HTMLIFrameElement>();
    const listen = (doc: Document) => {
      if (docs.includes(doc)) return;
      docs.push(doc);
      for (const type of INPUT_EVENTS) doc.addEventListener(type, onInput, INPUT_OPTS);
    };
    const attachFrame = (frame: HTMLIFrameElement) => {
      try {
        const doc = frame.contentDocument; // null when cross-origin
        if (doc && doc.location.href !== "about:blank") listen(doc);
      } catch {
        /* cross-origin */
      }
    };
    const onFrameLoad = (e: Event) => attachFrame(e.target as HTMLIFrameElement);
    const scanFrames = () => {
      for (const frame of document.querySelectorAll("iframe")) {
        if (!frames.has(frame)) {
          frames.add(frame);
          frame.addEventListener("load", onFrameLoad);
        }
        attachFrame(frame);
      }
    };

    const tick = () => {
      scanFrames(); // frames can mount after this hook does
      if (document.visibilityState !== "visible" || Date.now() - lastInput > DWELL_IDLE) return;
      let next: string | null = null;
      try {
        next = getRef.current();
      } catch {
        /* a section lookup must never break the page */
      }
      if (next === null) return;
      if (next !== section) {
        save();
        section = next;
      }
      secs += DWELL_TICK;
      if (secs >= DWELL_CAP) save();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };

    listen(document);
    scanFrames();
    const timer = setInterval(tick, DWELL_TICK * 1000);
    document.addEventListener("visibilitychange", onVisibility);
    // Queue the pending seconds and send them now: logEvent's own pagehide listener may
    // already have run, or (if nothing was logged yet) be added too late to fire.
    const onPageHide = () => {
      save();
      flush();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onPageHide);
      for (const doc of docs) for (const type of INPUT_EVENTS) doc.removeEventListener(type, onInput, INPUT_OPTS);
      for (const frame of frames) frame.removeEventListener("load", onFrameLoad);
      save();
    };
  }, [course, lesson, view]);
}

// Quiz and lab events posted from inside the lesson iframe. The shared lesson scripts
// (quiz.js, editlab.js) post { type: "lesson-event", kind, ... } to the parent when framed;
// anything not from the current lesson frame, or not matching the contract, is ignored.
type LessonMsg =
  | { kind: "quiz"; section: string; q: string; right: boolean; first: boolean }
  | { kind: "lab"; section: string; lab: string; goal: boolean; detail: string };

function parseLessonMsg(d: unknown): LessonMsg | null {
  if (!d || typeof d !== "object") return null;
  const m = d as Record<string, unknown>;
  if (m.type !== "lesson-event" || typeof m.section !== "string") return null;
  if (m.kind === "quiz" && typeof m.q === "string" && typeof m.right === "boolean" && typeof m.first === "boolean")
    return { kind: "quiz", section: m.section, q: m.q, right: m.right, first: m.first };
  if (m.kind === "lab" && typeof m.lab === "string" && typeof m.goal === "boolean" && typeof m.detail === "string")
    return { kind: "lab", section: m.section, lab: m.lab, goal: m.goal, detail: m.detail };
  return null;
}

export function useLessonMessages(
  course: string,
  lesson: string,
  view: View,
  frameRef: RefObject<HTMLIFrameElement | null>,
): void {
  useEffect(() => {
    function onMessage(e: MessageEvent) {
      // Compare at message time: the ref fills in after mount and the frame can navigate.
      const win = frameRef.current?.contentWindow;
      if (!win || e.source !== win) return;
      const m = parseLessonMsg(e.data);
      if (!m) return;
      if (m.kind === "quiz") logEvent(course, { view, lesson, ...m, fromGap: false });
      else logEvent(course, { view, lesson, ...m });
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [course, lesson, view, frameRef]);
}
