"use client";

// The lesson view: a lesson on a pan-and-zoom canvas. Highlighting text (in the lesson
// or in any card) opens a card beside it; zooming into a card deepens it through
// four levels: definition, plain words, mechanism, drawing. Each level streams
// from /api/explain, and the next level is fetched ahead of the zoom. A highlight can also
// be asked about in the tutor margin (Simple / Mid / Deep, with follow-ups). A link to another
// lesson or cheat sheet opens that page beside the lesson on the same canvas.

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import "katex/dist/katex.min.css";
import { markdownWithMath } from "@/lib/mathMarkdown";
import { logEvent, useDwell, useLessonMessages } from "@/lib/events";
import ReturnPanel from "@/components/ReturnPanel";
import SessionEnd from "@/components/SessionEnd";
import TutorPanel, { type TutorPanelHandle } from "@/components/TutorPanel";
import { LEVEL_LABEL, type TutorLevel } from "@/lib/tutor";

type Status = "idle" | "streaming" | "done" | "error";
type Card = {
  id: string;
  parentId: string | null; // null = opened from a page (the lesson, or the linked page in `page`)
  page?: string; // with no parent: the id of the linked page it was opened from (absent = the lesson)
  term: string;
  context: string;
  trail: string[];
  x: number; // world x of the card's left edge
  relX: number; // anchor (end of the highlight), relative to the parent's top-left
  relY: number;
  level: number; // deepest level revealed, 1..4
  parts: string[]; // text of each level
  status: Status[];
  y?: number; // world y once the reader has dragged the card (otherwise it stacks in its column)
  w?: number; // size once the reader has resized it
  h?: number;
  createdAt?: number; // ms when the card was opened (cards saved before this field have none)
  // Set when the card reuses the finished levels of an earlier card for the same term.
  from?: { lesson: string; card: string; createdAt?: number };
  // "Recall first?" on a reused card: ask = the question is showing, had = the old text is
  // showing with the optional "Had it?", done = answered or skipped. Saved, so a reload never asks again.
  recall?: { step: "ask" | "had" | "done"; q?: string; had?: boolean };
};
/** A finished card from any lesson of this course, as /api/cards returns it. */
type PastCard = { lesson: string; card: string; term: string; level: number; parts: string[]; createdAt?: number };
type View = { x: number; y: number; k: number };
/** A page opened from a link, laid beside the lesson: a lesson or cheat sheet, or an external page
    (href: its address; src is then the app's copy of it, /api/page). x, y: its top-left in the world. */
type Page = { id: string; src: string; href?: string; title: string; x: number; y: number };
const proxied = (href: string) => `/api/page?url=${encodeURIComponent(href)}`;

const LESSON_W = 880;
const CARD_W = 360;
const GAP_X = 90;
const GAP_Y = 16;
const LEVEL_AT = [0, 0, 1.15, 1.35, 1.6]; // canvas scale at which level n opens
const LEVEL_NAME = ["", "Definition", "In plain words", "How it works", "Picture"];
const STOPS = [0.5, 0.75, 1, 1.15, 1.35, 1.6, 2]; // Ctrl + scroll moves between these, one per notch

const PAGE_W = LESSON_W;
const MECH_W = 440; // "How it works" and deeper hold formulas and worked examples: give them room
const wOf = (c: Card) => c.w ?? (c.level >= 3 ? MECH_W : CARD_W);
const levelFor = (k: number) => (k >= LEVEL_AT[4] ? 4 : k >= LEVEL_AT[3] ? 3 : k >= LEVEL_AT[2] ? 2 : 1);
const newId = () => Math.random().toString(36).slice(2, 10);
const normTerm = (t: string) => t.replace(/\s+/g, " ").trim().toLowerCase();
const SESSION_GAP = 45 * 60 * 1000; // an explore older than this was in an earlier session
const RECALL_WAIT = 4000; // ms to wait for a generated recall question before asking a plain one
const recallFallback = (term: string) => `What do you remember about ${term}?`;

/** The level this learner usually reaches: median of the highest level per card over their
    last 20 cards (explore = 1, deepen = its level), at most 3 so the drawing is never opened
    unasked. 1 with no history. Even counts take the lower middle, to err shallow. */
function usualDepth(evs: { kind?: string; card?: string; level?: number }[]): number {
  const top = new Map<string, number>(); // insertion order = order the cards were first logged
  for (const e of evs) {
    if (typeof e.card !== "string") continue;
    const lv = e.kind === "explore" ? (typeof e.level === "number" ? e.level : 1) : e.kind === "deepen" && typeof e.level === "number" ? e.level : 0;
    if (lv) top.set(e.card, Math.max(top.get(e.card) ?? 0, lv));
  }
  const last = [...top.values()].slice(-20).sort((a, b) => a - b);
  if (!last.length) return 1;
  return Math.min(3, Math.max(1, last[Math.floor((last.length - 1) / 2)]));
}

/** A lesson h2: its top in the iframe document and its text. */
type Heading = { top: number; text: string };
/** The text of the last heading at or above document y, or "" above the first one. */
function headingAt(hs: Heading[], y: number): string {
  let text = "";
  for (const h of hs) {
    if (h.top > y) break;
    text = h.text;
  }
  return text;
}

/** A highlight waiting for the reader to press Explore or Ask. page: the linked page it is on
    (null = the lesson, or the card in parent). heading: where it is, for the tutor. */
type Pick = { parent: Card | null; page: Page | null; term: string; heading: string; context: string; relX: number; relY: number; range: Range };

/** Grow a range so it never cuts through a typeset formula. */
function wholeMath(range: Range): Range {
  const r = range.cloneRange();
  const mathOf = (n: Node) => (n.nodeType === 1 ? (n as Element) : n.parentElement)?.closest(".katex");
  const a = mathOf(r.startContainer);
  const b = mathOf(r.endContainer);
  if (a) r.setStartBefore(a);
  if (b) r.setEndAfter(b);
  return r;
}

/** The text of a range with each formula as its $TeX$ (KaTeX keeps the source in an annotation),
    instead of the hidden MathML and the drawn glyphs run together. */
function rangeText(range: Range): string {
  const frag = range.cloneContents();
  for (const k of Array.from(frag.querySelectorAll(".katex"))) {
    const tex = k.querySelector('annotation[encoding="application/x-tex"]')?.textContent?.trim();
    const shown = k.querySelector(".katex-html")?.textContent ?? k.textContent ?? "";
    k.replaceWith(k.ownerDocument.createTextNode(tex ? ` $${tex}$ ` : shown));
  }
  return (frag.textContent ?? "").replace(/\s+/g, " ").trim();
}
/** An element's text, maths as $TeX$. */
function elText(el: Element): string {
  const r = el.ownerDocument.createRange();
  r.selectNodeContents(el);
  return rangeText(r);
}

/** The word under a point, as a range (for Alt + click). */
function wordRangeAt(doc: Document, x: number, y: number): Range | null {
  const d = doc as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const pos = d.caretPositionFromPoint?.(x, y);
  const r0 = pos ? null : d.caretRangeFromPoint?.(x, y);
  const node = pos?.offsetNode ?? r0?.startContainer;
  const off = pos?.offset ?? r0?.startOffset ?? 0;
  if (!node || node.nodeType !== 3) return null;
  const t = (node as Text).data;
  const isWord = (ch: string) => /[\p{L}\p{N}_'’-]/u.test(ch);
  let a = off;
  let b = off;
  while (a > 0 && isWord(t[a - 1])) a--;
  while (b < t.length && isWord(t[b])) b++;
  if (b - a < 2) return null;
  const r = doc.createRange();
  r.setStart(node, a);
  r.setEnd(node, b);
  return r;
}

/** Keep only inert drawing markup from a model-written SVG. */
function sanitizeSvg(raw: string): string {
  const start = raw.indexOf("<svg");
  if (start < 0) return "";
  const doc = new DOMParser().parseFromString(raw.slice(start), "text/html");
  const svg = doc.querySelector("svg");
  if (!svg) return "";
  const banned = new Set(["script", "style", "foreignobject", "iframe", "object", "embed", "link", "meta", "image", "audio", "video"]);
  for (const el of [svg, ...Array.from(svg.querySelectorAll("*"))]) {
    if (banned.has(el.tagName.toLowerCase())) {
      el.remove();
      continue;
    }
    for (const a of Array.from(el.attributes)) {
      const n = a.name.toLowerCase();
      const v = a.value.trim().toLowerCase();
      if (n.startsWith("on")) el.removeAttribute(a.name);
      else if ((n === "href" || n === "xlink:href") && !v.startsWith("#")) el.removeAttribute(a.name);
      else if (v.includes("url(") && !v.includes("url(#")) el.removeAttribute(a.name);
      else if (v.includes("javascript:")) el.removeAttribute(a.name);
    }
  }
  svg.removeAttribute("height");
  svg.setAttribute("width", "100%");
  return svg.outerHTML;
}

function Part({ level, text, status }: { level: number; text: string; status: Status }) {
  const html = useMemo(
    () => (level === 4 ? sanitizeSvg(text) : markdownWithMath(text)),
    [level, text],
  );
  if (status === "error") return <p className="cv-err">{text || "The tutor didn’t answer."}</p>;
  if (!html) return <p className="cv-wait">{level === 4 ? "Drawing…" : "Thinking…"}</p>;
  return (
    <div
      className={level === 4 ? "cv-svg" : `cv-text${status === "streaming" ? " live" : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

/** A card's title; a term highlighted over maths arrives as $TeX$ and is typeset. */
function Term({ text }: { text: string }) {
  const html = useMemo(() => (text.includes("$") ? markdownWithMath(text).replace(/^<p>|<\/p>\s*$/g, "") : null), [text]);
  return html ? <h3 dangerouslySetInnerHTML={{ __html: html }} /> : <h3>{text}</h3>;
}

export default function LessonCanvas({
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
  prev: { slug: string; title: string } | null;
  next: { slug: string; title: string } | null;
}) {
  const storeKey = `learn.canvas.v1:${courseSlug}/${lessonSlug}`;
  const [cards, setCards] = useState<Card[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [view, setView] = useState<View>({ x: 40, y: 24, k: 1 });
  const [ease, setEase] = useState<"none" | "wheel" | "glide">("none");
  // While the view is moving, the world is a GPU layer (smooth). When it stops, the hint is
  // dropped so the browser repaints the text sharply at the new zoom instead of stretching
  // the old bitmap (the blur seen after zooming). See .cv-world in reader.css.
  const [live, setLive] = useState(false);
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bumpLive = useCallback(() => {
    setLive(true);
    if (liveTimer.current) clearTimeout(liveTimer.current);
    liveTimer.current = setTimeout(() => setLive(false), 250);
  }, []);
  const back = useRef<View | null>(null); // where the reader was before gliding onto a card
  const [canBack, setCanBack] = useState(false);
  const [pick, setPick] = useState<Pick | null>(null);
  const zoomAcc = useRef(0); // trackpad pinch deltas, summed until they amount to one step
  const altAt = useRef(0); // when an Alt + highlight was last handled (its click must not open a second card)
  const [frameH, setFrameH] = useState(1200);
  const frameHRef = useRef(frameH);
  frameHRef.current = frameH;
  const [ys, setYs] = useState<Record<string, number>>({});
  const [moving, setMoving] = useState(false); // a card is being dragged or resized
  const [pages, setPages] = useState<Page[]>([]);
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  const [pageH, setPageH] = useState<Record<string, number>>({});
  const pageFrames = useRef(new Map<string, HTMLIFrameElement>());
  const [tutorOpen, setTutorOpen] = useState(false);
  // The how-to tips over an empty canvas; once dismissed they stay hidden in this browser.
  const [hintGone, setHintGone] = useState(true); // read once the saved canvas has loaded (see below)
  const hideHint = useCallback(() => {
    setHintGone(true);
    try {
      localStorage.setItem("learn.canvas.hintGone", "1");
    } catch {
      /* storage blocked: hidden for this visit only */
    }
  }, []);
  const tutor = useRef<TutorPanelHandle>(null);

  const viewRef = useRef(view);
  viewRef.current = view;
  const cardsRef = useRef(cards);
  cardsRef.current = cards;
  const ysRef = useRef(ys);
  ysRef.current = ys;
  const vpRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  // Lesson h2 positions in iframe document px, refreshed whenever the lesson resizes,
  // so getSection (called often by useDwell) does no layout work of its own.
  // The lesson's are under "", each linked page's under its id.
  const heads = useRef(new Map<string, Heading[]>());
  const getSection = useCallback((): string | null => {
    const vp = vpRef.current;
    if (!vp) return null;
    const { x, y, k } = viewRef.current;
    const w = vp.clientWidth;
    const h = vp.clientHeight;
    // The lesson counts as in view only if it fills a fair share of the screen's width
    // (when the view glides onto a card, a sliver of the lesson often stays at the edge).
    const seen = Math.min(w, x + LESSON_W * k) - Math.max(0, x);
    if (seen < w / 4 || y > h || y + frameHRef.current * k < 0) return null;
    return headingAt(heads.current.get("") ?? [], (h / 2 - y) / k);
  }, []);
  useDwell(courseSlug, lessonSlug, "canvas", getSection);
  useLessonMessages(courseSlug, lessonSlug, "canvas", frameRef);
  const cardEls = useRef(new Map<string, HTMLElement>());
  const aborts = useRef(new Map<string, AbortController>());
  const wired = useRef(new WeakSet<Document>());
  const marks = useRef(new Map<string, Highlight>()); // highlighted passages, per page ("" = the lesson)

  // ---- persistence: learning/<course>/app-data/canvas/<lesson>.json, with localStorage as a cache ----
  const fileName = `canvas/${lessonSlug}`;
  useEffect(() => {
    let dead = false;
    let local: Card[] | null = null;
    try {
      local = (JSON.parse(localStorage.getItem(storeKey) ?? "null") as { cards?: Card[] } | null)?.cards ?? null;
    } catch {
      /* nothing saved */
    }
    fetch(`/api/state?course=${courseSlug}&name=${fileName}`)
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((file: { cards?: Card[]; pages?: Page[] } | null) => {
        if (dead) return;
        if (file?.pages) setPages(file.pages);
        let gone = false;
        try {
          gone = localStorage.getItem("learn.canvas.hintGone") === "1";
        } catch {
          /* storage blocked: show the tips */
        }
        setHintGone(gone);
        const saved = file?.cards ?? local; // the file wins; a browser's older cards are used until one exists
        if (saved)
          setCards(
            saved.map((c) => ({
              ...c,
              parts: c.parts.map((p, i) => (c.status[i] === "done" ? p : "")),
              status: c.status.map((s) => (s === "done" ? "done" : "idle")),
            })),
          );
        setLoaded(true);
      });
    return () => {
      dead = true;
    };
  }, [storeKey, courseSlug, fileName]);
  // Save at most once a second, including while a card is still streaming.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded || saveTimer.current) return;
    saveTimer.current = setTimeout(() => {
      saveTimer.current = null;
      const body = JSON.stringify({ cards: cardsRef.current, pages: pagesRef.current });
      try {
        localStorage.setItem(storeKey, body);
      } catch {
        /* storage full or blocked */
      }
      fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: `{"course":${JSON.stringify(courseSlug)},"name":${JSON.stringify(fileName)},"data":${body}}`,
      }).catch(() => {});
    }, 1000);
  }, [cards, pages, loaded, storeKey, courseSlug, fileName]);

  // ---- study log ----
  // Explores from earlier visits, fetched once, so a new card can say whether its term was seen before.
  const pastRef = useRef<{ term: string; t: number }[]>([]);
  const usualRef = useRef(1); // the level new cards open at (see usualDepth)
  const pastCardsRef = useRef<PastCard[]>([]); // finished cards of this course, fetched once
  useEffect(() => {
    let dead = false;
    fetch(`/api/events?course=${courseSlug}`)
      .then((r) => (r.ok ? r.json() : []), () => [])
      .then((evs: { kind?: string; term?: string; t?: string; card?: string; level?: number }[]) => {
        if (dead || !Array.isArray(evs)) return;
        pastRef.current = evs
          .filter((e) => e.kind === "explore" && typeof e.term === "string")
          .map((e) => ({ term: normTerm(e.term!), t: Date.parse(e.t ?? "") }));
        usualRef.current = usualDepth(evs);
      });
    fetch(`/api/cards?course=${courseSlug}`)
      .then((r) => (r.ok ? r.json() : []), () => [])
      .then((cs: PastCard[]) => {
        if (!dead && Array.isArray(cs)) pastCardsRef.current = cs;
      });
    return () => {
      dead = true;
    };
  }, [courseSlug]);

  // One `deepen` per level a card gains, whatever raised it (Zoom in bar, Ctrl + scroll).
  // Levels seen at load are the baseline, so restoring saved cards logs nothing.
  const levelsRef = useRef<Map<string, number> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    const seen = levelsRef.current;
    levelsRef.current = new Map(cards.map((c) => [c.id, c.level]));
    if (!seen) return;
    for (const c of cards)
      for (let lv = (seen.get(c.id) ?? c.level) + 1; lv <= c.level; lv++)
        logEvent(courseSlug, { kind: "deepen", lesson: lessonSlug, view: "canvas", card: c.id, term: c.term, level: lv as 2 | 3 | 4 });
  }, [cards, loaded, courseSlug, lessonSlug]);

  // ---- streaming ----
  const patch = useCallback((id: string, lv: number, text: string | null, status: Status) => {
    setCards((cs) =>
      cs.map((c) =>
        c.id !== id
          ? c
          : {
              ...c,
              parts: text === null ? c.parts : c.parts.map((p, i) => (i === lv - 1 ? text : p)),
              status: c.status.map((s, i) => (i === lv - 1 ? status : s)),
            },
      ),
    );
  }, []);

  const start = useCallback(
    async (c: Card, lv: number) => {
      const key = `${c.id}:${lv}`;
      const ctrl = new AbortController();
      aborts.current.set(key, ctrl);
      patch(c.id, lv, "", "streaming");
      let acc = "";
      let raf = 0;
      try {
        const res = await fetch("/api/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: ctrl.signal,
          body: JSON.stringify({
            course: courseTitle,
            courseSlug,
            lesson: lessonTitle,
            term: c.term,
            context: c.context,
            trail: c.trail,
            level: lv,
            prior: c.parts.slice(0, Math.min(lv - 1, 3)).join("\n\n"),
          }),
        });
        if (!res.ok || !res.body) throw new Error(`request failed (${res.status})`);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          acc += dec.decode(value, { stream: true });
          if (!raf)
            raf = requestAnimationFrame(() => {
              raf = 0;
              patch(c.id, lv, acc, "streaming");
            });
        }
        cancelAnimationFrame(raf);
        const err = acc.indexOf("[tutor error]");
        if (err >= 0) patch(c.id, lv, acc.slice(err + 13).trim(), "error");
        else patch(c.id, lv, acc.trim(), "done");
      } catch (e) {
        cancelAnimationFrame(raf);
        if ((e as Error).name !== "AbortError")
          patch(c.id, lv, `The tutor didn’t answer (${(e as Error).message}).`, "error");
      } finally {
        aborts.current.delete(key);
      }
    },
    [courseTitle, courseSlug, lessonTitle, patch],
  );

  // "Prefetch pictures" (Control room > Models): when off, the picture (level 4) is never
  // fetched ahead, only once the card is zoomed to it. Held off until the setting is known.
  const [prefetchPictures, setPrefetchPictures] = useState(false);
  useEffect(() => {
    fetch("/api/settings")
      .then((r) => (r.ok ? r.json() : null), () => null)
      .then((s: { prefetchPictures?: boolean } | null) => setPrefetchPictures(s?.prefetchPictures !== false));
  }, []);

  // Fetch every revealed level plus one ahead, each after the level before it.
  useEffect(() => {
    if (!loaded) return;
    for (const c of cards)
      for (let lv = 1; lv <= Math.min(prefetchPictures || c.level >= 4 ? 4 : 3, c.level + 1); lv++)
        if (
          c.recall?.step !== "ask" && // a reused card waits for its recall question before fetching ahead
          c.status[lv - 1] === "idle" &&
          (lv === 1 || c.status[lv - 2] === "done") &&
          !aborts.current.has(`${c.id}:${lv}`)
        )
          start(c, lv);
  }, [cards, loaded, start, prefetchPictures]);

  useEffect(() => {
    const live = aborts.current;
    return () => live.forEach((a) => a.abort());
  }, []);

  // ---- "Recall first?" on reused cards ----
  // The question is generated once per old card by /api/recall (cached there). If it has not
  // come within RECALL_WAIT, or the call fails, a plain question takes its place for good.
  const recallAsked = useRef(new Set<string>());
  useEffect(() => {
    if (!loaded) return;
    for (const c of cards) {
      if (c.recall?.step !== "ask" || c.recall.q || !c.from || recallAsked.current.has(c.id)) continue;
      recallAsked.current.add(c.id);
      const { id, term } = c;
      let settled = false;
      const settle = (q: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        setCards((cs) => cs.map((x) => (x.id === id && x.recall && !x.recall.q ? { ...x, recall: { ...x.recall, q } } : x)));
      };
      const timer = setTimeout(() => settle(recallFallback(term)), RECALL_WAIT);
      fetch("/api/recall", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // the written levels only: a drawing says nothing a question can be built on
        body: JSON.stringify({ course: courseSlug, card: c.from.card, term, text: c.parts.slice(0, 3).filter(Boolean).join("\n\n") }),
      })
        .then((r) => (r.ok ? r.json() : null))
        .then(
          (d: { q?: unknown } | null) => settle(typeof d?.q === "string" ? d.q : recallFallback(term)),
          () => settle(recallFallback(term)),
        );
    }
  }, [cards, loaded, courseSlug]);

  function showOld(c: Card) {
    setCards((cs) => cs.map((x) => (x.id === c.id && x.recall ? { ...x, recall: { ...x.recall, step: "had" } } : x)));
  }
  /** Close the ask: had = the learner's yes / no after seeing the old text, null = skipped. */
  function answerRecall(c: Card, had: boolean | null) {
    if (c.from) logEvent(courseSlug, { kind: "recall", lesson: lessonSlug, view: "canvas", term: c.term, card: c.from.card, had });
    setCards((cs) =>
      cs.map((x) => (x.id === c.id && x.recall ? { ...x, recall: { ...x.recall, step: "done", ...(had === null ? {} : { had }) } } : x)),
    );
  }

  /** The linked page a card was opened from, if it was opened from one (not the lesson or a card). */
  const pageOf = useCallback((c: Card) => (c.parentId || !c.page ? undefined : pagesRef.current.find((p) => p.id === c.page)), []);

  // ---- layout: cards in the same column stack downwards without overlapping ----
  const relayout = useCallback(() => {
    const cs = cardsRef.current;
    const next: Record<string, number> = {};
    const done = new Set<string>();
    const cols = new Map<number, number>(); // column x -> next free y
    // parents before children, then top to bottom
    const want = (c: Card): number => (c.parentId ? (next[c.parentId] ?? 0) : (pageOf(c)?.y ?? 0)) + c.relY - 24;
    let pending = cs.slice();
    while (pending.length) {
      const ready = pending.filter((c) => !c.parentId || done.has(c.parentId) || !cs.some((p) => p.id === c.parentId));
      if (!ready.length) break;
      ready.sort((a, b) => want(a) - want(b));
      for (const c of ready) {
        if (c.y !== undefined) {
          next[c.id] = c.y;
          done.add(c.id);
          continue;
        }
        const y = Math.max(want(c), cols.get(c.x) ?? -Infinity);
        next[c.id] = y;
        cols.set(c.x, y + (cardEls.current.get(c.id)?.offsetHeight ?? 120) + GAP_Y);
        done.add(c.id);
      }
      pending = pending.filter((c) => !done.has(c.id));
    }
    const prev = ysRef.current;
    const keys = Object.keys(next);
    if (keys.length !== Object.keys(prev).length || keys.some((k) => Math.abs((prev[k] ?? NaN) - next[k]) > 0.5))
      setYs(next);
  }, [pageOf]);
  useLayoutEffect(relayout, [cards, pages, relayout]);
  const ro = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    ro.current = new ResizeObserver(relayout);
    cardEls.current.forEach((el) => ro.current!.observe(el));
    return () => ro.current?.disconnect();
  }, [relayout]);
  const setCardEl = useCallback((id: string, el: HTMLElement | null) => {
    const old = cardEls.current.get(id);
    if (old && old !== el) ro.current?.unobserve(old);
    if (el) {
      cardEls.current.set(id, el);
      ro.current?.observe(el);
    } else cardEls.current.delete(id);
  }, []);

  // ---- pan / zoom ----
  const rememberHome = useCallback(() => {
    if (back.current) return;
    back.current = viewRef.current;
    setCanBack(true);
  }, []);

  const cardAt = useCallback(
    (wx: number, wy: number) =>
      cardsRef.current.find((c) => {
        const y = ysRef.current[c.id];
        const h = cardEls.current.get(c.id)?.offsetHeight ?? 0;
        return y !== undefined && wx >= c.x && wx <= c.x + wOf(c) && wy >= y && wy <= y + h;
      }),
    [],
  );

  /** Where the view sits so a card is centred, with the end of what it already shows
      near the upper part of the screen (the part about to be revealed lands in view). */
  const onCard = useCallback((c: Card, k: number): View => {
    const r = vpRef.current!.getBoundingClientRect();
    const y = ysRef.current[c.id] ?? 0;
    const h = cardEls.current.get(c.id)?.offsetHeight ?? 0;
    return { k, x: r.width / 2 - (c.x + wOf(c) / 2) * k, y: Math.min(70 - y * k, r.height * 0.4 - (y + h) * k) };
  }, []);

  /** One zoom step to the next stop, eased. Zooming in over a card deepens it and pans onto it. */
  const zoomStep = useCallback(
    (dir: 1 | -1, px: number, py: number) => {
      const v = viewRef.current;
      const k = dir > 0 ? STOPS.find((s) => s > v.k + 0.005) : [...STOPS].reverse().find((s) => s < v.k - 0.005);
      if (!k) return;
      const wx = (px - v.x) / v.k;
      const wy = (py - v.y) / v.k;
      const hit = dir > 0 ? cardAt(wx, wy) : undefined;
      if (dir > 0) rememberHome();
      setEase("glide");
      if (hit && levelFor(k) > hit.level && hit.recall?.step !== "ask") {
        const lv = levelFor(k);
        setCards((cs) => cs.map((c) => (c.id === hit.id ? { ...c, level: lv } : c)));
        setView(onCard(hit, k));
      } else if (hit) {
        const r = vpRef.current!.getBoundingClientRect();
        setView({ k, x: r.width / 2 - (hit.x + wOf(hit) / 2) * k, y: py - wy * k });
      } else setView({ k, x: px - wx * k, y: py - wy * k });
    },
    [cardAt, onCard, rememberHome],
  );

  const wheel = useCallback(
    (clientX: number, clientY: number, dx: number, dy: number, zoom: boolean) => {
      const r = vpRef.current!.getBoundingClientRect();
      // A mouse wheel sends one big step per notch; a trackpad sends many small ones.
      const notch = Math.abs(dy) >= 50 || Math.abs(dx) >= 50;
      if (!zoom) {
        const v = viewRef.current;
        if (!notch) bumpLive();
        setEase(notch ? "wheel" : "none");
        setView({ ...v, x: v.x - dx, y: v.y - dy });
        return;
      }
      zoomAcc.current = notch ? Math.sign(dy) * 40 : zoomAcc.current + dy;
      if (Math.abs(zoomAcc.current) < 40) return;
      const dir = zoomAcc.current < 0 ? 1 : -1;
      zoomAcc.current = 0;
      zoomStep(dir, clientX - r.left, clientY - r.top);
    },
    [zoomStep, bumpLive],
  );

  const onWheelEvent = useCallback(
    (e: WheelEvent, clientX: number, clientY: number) => {
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1;
      let dx = e.deltaX * unit;
      let dy = e.deltaY * unit;
      const zoom = e.ctrlKey || e.metaKey;
      if (e.shiftKey && !zoom && dx === 0) [dx, dy] = [dy, 0];
      wheel(clientX, clientY, dx, dy, zoom);
    },
    [wheel],
  );

  useEffect(() => {
    const vp = vpRef.current!;
    const onWheel = (e: WheelEvent) => {
      // a card shorter than its text scrolls itself until it reaches its end
      const body = (e.target as Element).closest?.(".cv-body");
      if (body && !e.ctrlKey && !e.metaKey && !e.shiftKey && e.deltaY !== 0) {
        const room = e.deltaY < 0 ? body.scrollTop > 0 : body.scrollTop + body.clientHeight < body.scrollHeight - 1;
        if (room) return;
      }
      onWheelEvent(e, e.clientX, e.clientY);
    };
    vp.addEventListener("wheel", onWheel, { passive: false });
    return () => vp.removeEventListener("wheel", onWheel);
  }, [onWheelEvent]);

  const goBack = useCallback(() => {
    if (!back.current) return;
    setEase("glide");
    setView(back.current);
    back.current = null;
    setCanBack(false);
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && goBack();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goBack]);

  function startPan(e: React.PointerEvent) {
    if (!(e.target as HTMLElement).closest(".cv-pick, .cv-body")) setPick(null);
    const on = (e.target as HTMLElement).closest(".cv-card, .cv-lesson, .cv-page, .cv-hud");
    if (e.button === 1 ? on?.matches(".cv-hud") : e.button !== 0 || on) return;
    e.preventDefault();
    const v0 = viewRef.current;
    const x0 = e.clientX;
    const y0 = e.clientY;
    setEase("none");
    const move = (ev: PointerEvent) => {
      bumpLive();
      setView({ ...v0, x: v0.x + ev.clientX - x0, y: v0.y + ev.clientY - y0 });
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Reveal a level of a card (the Zoom in bar) and glide the view onto it. */
  function deepen(c: Card, lv: number) {
    setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, level: Math.max(x.level, lv) } : x)));
    rememberHome();
    setEase("glide");
    setView(onCard(c, Math.max(viewRef.current.k, LEVEL_AT[lv])));
  }

  // ---- spawning cards ----
  const spawn = useCallback(
    (parent: Card | null, page: Page | null, term: string, context: string, relX: number, relY: number) => {
      const t = term.replace(/\s+/g, " ").trim();
      if (t.length < 2 || t.length > 300) return null;
      const id = newId();
      // The section is where the chain of cards started: the nearest h2 above the root card's anchor
      // (on the lesson, or on the linked page the chain started on).
      let root = parent;
      while (root?.parentId) {
        const up: string = root.parentId;
        root = cardsRef.current.find((c) => c.id === up) ?? null;
      }
      const rootPage = root ? root.page : page?.id;
      const now = Date.now();
      const key = normTerm(t);
      // An earlier card for this term (another lesson, or this one in an earlier session) lends
      // its finished levels, so they cost no new Claude call. The deepest such card wins; ties go
      // to the oldest, the one the learner first wrote.
      const old = pastCardsRef.current
        .filter(
          (p) =>
            normTerm(p.term) === key &&
            (p.lesson !== lessonSlug || p.createdAt === undefined || now - p.createdAt >= SESSION_GAP),
        )
        .sort((a, b) => b.parts.length - a.parts.length || (a.createdAt ?? 0) - (b.createdAt ?? 0))[0];
      logEvent(courseSlug, {
        kind: "explore",
        lesson: lessonSlug,
        view: "canvas",
        term: t,
        from: parent?.term ?? null,
        section: headingAt(heads.current.get(rootPage ?? "") ?? [], root ? root.relY : relY),
        context: context.slice(0, 600),
        card: id,
        seenBefore: pastRef.current.some((e) => e.term === key && now - e.t > SESSION_GAP),
        // the depth it opens at, so a card opened deeper isn't counted as a level-1 card by usualDepth
        level: old ? old.level : usualRef.current,
      });
      setCards((cs) => [
        ...cs,
        {
          id,
          parentId: parent?.id ?? null,
          ...(!parent && page ? { page: page.id } : {}),
          term: t,
          context,
          trail: parent ? [...parent.trail, parent.term] : [],
          x: (parent ? parent.x + wOf(parent) : page ? page.x + PAGE_W : LESSON_W) + GAP_X,
          relX,
          relY,
          // A new card opens at the learner's usual depth; levels it starts at are not deepens
          // (the deepen log takes a card's first level as its baseline).
          level: old ? old.level : usualRef.current,
          parts: [0, 1, 2, 3].map((i) => old?.parts[i] ?? ""),
          status: [0, 1, 2, 3].map((i): Status => (old && i < old.parts.length ? "done" : "idle")),
          createdAt: now,
          ...(old ? { from: { lesson: old.lesson, card: old.card, createdAt: old.createdAt }, recall: { step: "ask" as const } } : {}),
        },
      ]);
      return id;
    },
    [courseSlug, lessonSlug],
  );

  const explore = useCallback(
    (p: Pick) => {
      const id = spawn(p.parent, p.page, p.term, p.context, p.relX, p.relY);
      if (!id) return;
      // once the card has its place (two frames), ease onto it at the reading zoom
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const c = cardsRef.current.find((x) => x.id === id);
          const y = ysRef.current[id];
          if (!c || y === undefined) return;
          const r = vpRef.current!.getBoundingClientRect();
          rememberHome();
          setEase("glide");
          setView({ k: 1, x: Math.min(r.width * 0.52, r.width - CARD_W - 40) - c.x, y: r.height * 0.3 - y });
        }),
      );
      if (!p.parent) marks.current.get(p.page?.id ?? "")?.add(p.range);
      p.range.startContainer.ownerDocument?.defaultView?.getSelection()?.removeAllRanges();
      setPick(null);
    },
    [spawn, rememberHome],
  );

  /** Ask the tutor about a highlight, at a depth; the answer opens in the margin. */
  const askTutor = useCallback((p: Pick, level: TutorLevel) => {
    tutor.current?.ask({ selection: p.term, heading: p.heading, context: p.context, level });
    if (!p.parent) marks.current.get(p.page?.id ?? "")?.add(p.range);
    p.range.startContainer.ownerDocument?.defaultView?.getSelection()?.removeAllRanges();
    setPick(null);
  }, []);

  // ---- linked pages ----
  /** Open a page beside the lesson (or glide to it if it is already open): path is a lesson or
      cheat sheet, or with href an external page's app copy. linkY: the link's top on the page it
      was clicked on (from: that page; null = the lesson). */
  const openPage = useCallback(
    (path: string, label: string, from: Page | null, linkY: number, href?: string) => {
      let at: { x: number; y: number } | undefined =
        path === new URL(src, window.location.href).pathname ? { x: 0, y: 0 } : pagesRef.current.find((p) => p.src === path);
      if (!at) {
        // to the right of everything on the canvas, level with the link
        const right = Math.max(
          LESSON_W,
          ...cardsRef.current.map((c) => c.x + wOf(c)),
          ...pagesRef.current.map((p) => p.x + PAGE_W),
        );
        const page: Page = {
          id: newId(),
          src: path,
          ...(href ? { href } : {}),
          title: label.replace(/\s+/g, " ").trim() || (href ? new URL(href).host : decodeURIComponent(path.split("/").pop() ?? "")),
          x: right + 2 * GAP_X,
          y: Math.max(0, (from?.y ?? 0) + linkY - 120),
        };
        setPages((ps) => [...ps, page]);
        at = page;
      }
      const r = vpRef.current!.getBoundingClientRect();
      rememberHome();
      setEase("glide");
      setView({ k: 1, x: Math.min(60, (r.width - PAGE_W) / 2) - at.x, y: 70 - at.y });
    },
    [src, rememberHome],
  );

  /** The cards opened from a linked page, and every card opened from those. */
  function pageCards(id: string) {
    const ids = new Set<string>();
    for (const c of cardsRef.current) if (!c.parentId && c.page === id) for (const x of subtree(c.id)) ids.add(x);
    return ids;
  }

  function closePage(id: string) {
    const gone = pageCards(id);
    aborts.current.forEach((a, key) => gone.has(key.split(":")[0]) && a.abort());
    setCards((cs) => cs.filter((c) => !gone.has(c.id)));
    setPages((ps) => ps.filter((p) => p.id !== id));
    marks.current.delete(id);
    pageFrames.current.delete(id);
    setPick(null);
  }

  /** Drag a linked page by its bar; the cards opened from it come along. */
  function startPageDrag(page: Page, e: React.PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, a")) return;
    setPick(null);
    const ids = pageCards(page.id);
    const p0 = { x: page.x, y: page.y };
    const from = new Map(cardsRef.current.filter((c) => ids.has(c.id)).map((c) => [c.id, { x: c.x, y: c.y }]));
    track(e, (dx, dy) => {
      setPages((ps) => ps.map((p) => (p.id === page.id ? { ...p, x: p0.x + dx, y: p0.y + dy } : p)));
      setCards((cs) =>
        cs.map((c) => {
          const f = from.get(c.id);
          return f ? { ...c, x: f.x + dx, y: f.y === undefined ? undefined : f.y + dy } : c;
        }),
      );
    });
  }

  /** A click in a page on the canvas (doc; page: the linked page it is, null = the lesson). Links
      to lessons, cheat sheets and other sites open beside it; a #jump glides the canvas there. */
  const followLink = useRef<(e: MouseEvent, doc: Document, page: Page | null) => void>(() => {});
  followLink.current = (e, doc, page) => {
    // A modified click keeps the browser's own meaning (new tab, new window).
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.defaultPrevented) return;
    const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    // the lesson's own way out (Library, Course map), and "open in a new tab" on a page that couldn't load
    if (!a || /^_(parent|top)$/.test(a.target) || a.dataset.out) return;
    const url = new URL(a.href);
    const here = new URL(page?.href ?? doc.location.href);
    if (url.origin + url.pathname + url.search === here.origin + here.pathname + here.search) {
      // A jump within this page. The frame never scrolls (it is as tall as its page), so the
      // canvas glides to the spot instead.
      e.preventDefault();
      const id = decodeURIComponent(url.hash.slice(1));
      const el = id ? (doc.getElementById(id) ?? doc.getElementsByName(id)[0]) : doc.body;
      if (!el) return;
      const v = viewRef.current;
      rememberHome();
      setEase("glide");
      setView({ ...v, y: 70 - ((page?.y ?? 0) + el.getBoundingClientRect().top) * v.k });
    } else if (url.origin !== window.location.origin) {
      e.preventDefault();
      // Another site: the app serves a readable copy beside the lesson (see /api/page), unless
      // publishing found it can't be read here (data-open="tab", set by scripts/sync-courses.mjs).
      if (/^https?:$/.test(url.protocol) && a.dataset.open !== "tab") openPage(proxied(url.href), a.textContent ?? "", page, a.getBoundingClientRect().top, url.href);
      else window.open(url.href, "_blank", "noopener"); // and mailto: and the like
    } else if (/^\/courses\/.+\.html$/.test(url.pathname)) {
      e.preventDefault();
      openPage(url.pathname, a.textContent ?? "", page, a.getBoundingClientRect().top);
    } else {
      e.preventDefault();
      window.location.assign(url.href); // an app page: leave the canvas for it
    }
  };

  // The lesson iframe and each linked page are same-origin: size them to their content,
  // forward their wheel events to the canvas, offer their text selections as cards or
  // tutor questions, and open their links beside them instead of inside the frame.
  // key: "" for the lesson, else the linked page's id.
  const wireFrame = useCallback(
    (frame: HTMLIFrameElement | null, key: string) => {
      const doc = frame?.contentDocument;
      const win = frame?.contentWindow as (Window & typeof globalThis) | null | undefined;
      if (!frame || !doc?.body || !win || doc.location.href === "about:blank" || wired.current.has(doc)) return;
      wired.current.add(doc);
      const pageNow = () => (key ? (pagesRef.current.find((p) => p.id === key) ?? null) : null);
      doc.documentElement.style.overflow = "hidden";
      if (key && doc.title) setPages((ps) => ps.map((p) => (p.id === key ? { ...p, title: doc.title } : p)));
      const size = () => {
        const h = Math.max(600, doc.documentElement.scrollHeight);
        if (key) setPageH((m) => (m[key] === h ? m : { ...m, [key]: h }));
        else setFrameH(h);
        // the frame never scrolls (it is sized to its content), so client tops are document tops
        heads.current.set(
          key,
          Array.from(doc.querySelectorAll("h1, h2"), (el) => ({ // the h1 names the part above the first h2, as in the reader
            top: el.getBoundingClientRect().top,
            text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
          })),
        );
      };
      size();
      new win.ResizeObserver(size).observe(doc.body);

      doc.addEventListener(
        "wheel",
        (e) => {
          const r = frame.getBoundingClientRect();
          const k = viewRef.current.k;
          onWheelEvent(e, r.left + e.clientX * k, r.top + e.clientY * k);
        },
        { passive: false },
      );

      doc.addEventListener("keydown", (e) => e.key === "Escape" && goBack());

      // A lesson styles its highlights (ask-bridge.js) and the PDF viewer its own; a copied web page doesn't.
      if (doc.location.pathname === "/api/page") {
        const st = doc.createElement("style");
        st.textContent = "::highlight(asked){background-color:#ddf59e;color:#19221f}";
        (doc.head ?? doc.documentElement).append(st);
      }
      const hl = win.CSS?.highlights && win.Highlight ? new win.Highlight() : null;
      if (hl) {
        win.CSS.highlights.set("asked", hl);
        marks.current.set(key, hl);
      }
      const fromRange = (r0: Range): Pick => {
        const range = wholeMath(r0);
        const rects = range.getClientRects();
        const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
        const node = range.startContainer.nodeType === 3 ? range.startContainer.parentElement : (range.startContainer as Element);
        const block = node?.closest("p,li,figure,td,dd,h1,h2,h3,blockquote,div") as HTMLElement | null;
        const term = rangeText(range);
        const relY = last.top + last.height / 2;
        const page = pageNow();
        return {
          parent: null,
          page,
          term,
          heading: headingAt(heads.current.get(key) ?? [], relY) || page?.title || "",
          context: (block ? elText(block) : term).slice(0, 1800),
          relX: last.right,
          relY,
          range,
        };
      };
      // A highlight offers Explore and Ask; it never opens a card by itself.
      // Holding Alt while highlighting skips straight to a card.
      doc.addEventListener("mouseup", (e) => {
        const sel = win.getSelection();
        const p = sel && sel.rangeCount > 0 && !sel.isCollapsed ? fromRange(sel.getRangeAt(0)) : null;
        const ok = p && p.term.length >= 2 && p.term.length <= 300 ? p : null;
        if (!e.altKey) setPick(ok);
        else if (ok) {
          altAt.current = Date.now();
          explore(ok);
        }
      });
      doc.addEventListener("mousedown", () => setPick(null));
      doc.addEventListener("click", (e) => {
        // Alt + click a word: open its card straight away.
        if (e.altKey) {
          if (Date.now() - altAt.current < 400) return;
          const range = wordRangeAt(doc, e.clientX, e.clientY);
          if (!range) return;
          e.preventDefault();
          win.getSelection()?.removeAllRanges();
          explore(fromRange(range));
          return;
        }
        // through the ref, so a frame wired earlier still runs the current link rules
        followLink.current(e, doc, pageNow());
      });
    },
    [explore, onWheelEvent, goBack],
  );
  useEffect(() => {
    if (frameRef.current?.contentDocument?.readyState === "complete") wireFrame(frameRef.current, "");
    pageFrames.current.forEach((f, id) => f.contentDocument?.readyState === "complete" && wireFrame(f, id));
  }, [wireFrame, pages]);

  function pickInCard(c: Card, r0: Range): Pick {
    const range = wholeMath(r0);
    const rects = range.getClientRects();
    const last = rects[rects.length - 1] ?? range.getBoundingClientRect();
    const cardRect = cardEls.current.get(c.id)!.getBoundingClientRect();
    const k = viewRef.current.k;
    return {
      parent: c,
      page: null,
      term: rangeText(range),
      heading: c.term,
      context: c.parts.slice(0, 3).join("\n\n").slice(0, 1800),
      relX: (last.right - cardRect.left) / k,
      relY: (last.top + last.height / 2 - cardRect.top) / k,
      range,
    };
  }
  function onCardMouseUp(c: Card, e: React.MouseEvent) {
    const sel = window.getSelection();
    const body = e.currentTarget as HTMLElement;
    const p = sel && sel.rangeCount > 0 && !sel.isCollapsed && body.contains(sel.anchorNode) ? pickInCard(c, sel.getRangeAt(0)) : null;
    const ok = p && p.term.length >= 2 && p.term.length <= 300 ? p : null;
    if (!e.altKey) setPick(ok);
    else if (ok) {
      altAt.current = Date.now();
      explore(ok);
    }
  }
  function onCardClick(c: Card, e: React.MouseEvent) {
    if (!e.altKey || Date.now() - altAt.current < 400) return;
    const range = wordRangeAt(document, e.clientX, e.clientY);
    if (!range || !(e.currentTarget as HTMLElement).contains(range.startContainer)) return;
    e.preventDefault();
    explore(pickInCard(c, range));
  }

  /** A card and every card opened from it, however deep. */
  function subtree(id: string) {
    const ids = new Set([id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const c of cardsRef.current)
        if (c.parentId && ids.has(c.parentId) && !ids.has(c.id)) {
          ids.add(c.id);
          grew = true;
        }
    }
    return ids;
  }

  /** Follow the pointer until it is released; dx, dy in world units. */
  function track(e: React.PointerEvent, onMove: (dx: number, dy: number) => void) {
    e.preventDefault();
    e.stopPropagation();
    const k = viewRef.current.k;
    const x0 = e.clientX;
    const y0 = e.clientY;
    setMoving(true);
    const move = (ev: PointerEvent) => onMove((ev.clientX - x0) / k, (ev.clientY - y0) / k);
    const up = () => {
      setMoving(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** Drag a card by its title bar; the cards opened from it come along. */
  function startDrag(c: Card, e: React.PointerEvent) {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    setPick(null);
    const ids = subtree(c.id);
    const from = new Map(
      cardsRef.current.filter((x) => ids.has(x.id)).map((x) => [x.id, { x: x.x, y: x.id === c.id ? (x.y ?? ysRef.current[x.id] ?? 0) : x.y }]),
    );
    track(e, (dx, dy) =>
      setCards((cs) =>
        cs.map((x) => {
          const f = from.get(x.id);
          if (!f) return x;
          // children that were never dragged keep following their parent down the column
          return { ...x, x: f.x + dx, y: f.y === undefined ? undefined : f.y + dy };
        }),
      ),
    );
  }

  /** Resize a card from its corner; double-click the corner to fit it to its text again. */
  function startResize(c: Card, e: React.PointerEvent) {
    if (e.button !== 0) return;
    const el = cardEls.current.get(c.id)!;
    const w0 = el.offsetWidth;
    const h0 = el.offsetHeight;
    track(e, (dx, dy) =>
      setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, w: Math.max(240, w0 + dx), h: Math.max(140, h0 + dy) } : x))),
    );
  }
  function fitCard(c: Card) {
    setCards((cs) => cs.map((x) => (x.id === c.id ? { ...x, w: undefined, h: undefined } : x)));
  }

  function removeCard(id: string) {
    const gone = subtree(id);
    aborts.current.forEach((a, key) => gone.has(key.split(":")[0]) && a.abort());
    setCards((cs) => cs.filter((c) => !gone.has(c.id)));
  }

  function retry(c: Card, lv: number) {
    aborts.current.get(`${c.id}:${lv}`)?.abort();
    patch(c.id, lv, "", "idle");
  }

  function clearAll() {
    aborts.current.forEach((a) => a.abort());
    setCards([]);
    marks.current.forEach((hl) => hl.clear());
  }

  const byId = useMemo(() => new Map(cards.map((c) => [c.id, c])), [cards]);
  const pageById = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages]);
  /** Top-left of what a card (or highlight) hangs from when it has no parent card: its page, or the lesson. */
  const baseOf = (page: string | undefined) => pageById.get(page ?? "") ?? { x: 0, y: 0 };

  return (
    <div className="rd">
      <header className="rd-bar">
        <Link href={`/learn/${courseSlug}`} className="rd-bar-course">
          ← {courseTitle}
        </Link>
        <span className="rd-bar-title">{lessonTitle}</span>
        <div className="rd-bar-nav">
          {prev && <Link href={`/learn/${courseSlug}/${prev.slug}`}>Previous</Link>}
          {next && <Link href={`/learn/${courseSlug}/${next.slug}`}>Next</Link>}
          <Link href={`/learn/${courseSlug}/${lessonSlug}/reader`}>Reader</Link>
          <SessionEnd courseSlug={courseSlug} courseTitle={courseTitle} lessonSlug={lessonSlug} lessonTitle={lessonTitle} view="canvas" />
          {cards.length > 0 && (
            <button className="cv-clear" onClick={clearAll}>
              Clear {cards.length} {cards.length === 1 ? "card" : "cards"}
            </button>
          )}
          <button className="rd-toggle" aria-pressed={tutorOpen} onClick={() => setTutorOpen(!tutorOpen)}>
            Tutor
          </button>
        </div>
      </header>

      <div className="rd-body">
      <div ref={vpRef} className="cv-viewport" onPointerDown={startPan}>
        <div
          className={`cv-world ${ease}${live ? " live" : ""}${moving ? " moving" : ""}`}
          // whole pixels: text on a fractional offset renders soft
          style={{ transform: `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px) scale(${view.k})` }}
          // once an eased move ends, drop the transition (and with it the will-change hint)
          onTransitionEnd={(e) => e.target === e.currentTarget && e.propertyName === "transform" && setEase("none")}
        >
          <div className="cv-lesson" style={{ width: LESSON_W, height: frameH }}>
            <iframe ref={frameRef} src={src} title={lessonTitle} data-canvas="1" onLoad={(e) => wireFrame(e.currentTarget, "")} />
          </div>

          {pages.map((p) => (
            <div key={p.id} className="cv-page" style={{ left: p.x, top: p.y, width: PAGE_W, height: pageH[p.id] ?? 1000 }}>
              <header className="cv-page-bar" onPointerDown={(e) => startPageDrag(p, e)} title="Drag to move">
                <span>{p.title}</span>
                {p.href && (
                  <a href={p.href} target="_blank" rel="noopener noreferrer" title="Open the original in a new browser tab">
                    {new URL(p.href).host} ↗
                  </a>
                )}
                <button className="cv-x" onClick={() => closePage(p.id)} aria-label={`Close ${p.title}`}>
                  ✕
                </button>
              </header>
              <iframe
                ref={(el) => {
                  if (el) pageFrames.current.set(p.id, el);
                }}
                src={p.src}
                title={p.title}
                data-canvas="1"
                onLoad={(e) => wireFrame(e.currentTarget, p.id)}
              />
            </div>
          ))}

          <svg className="cv-links" width="1" height="1" aria-hidden="true">
            {cards.map((c) => {
              const y = ys[c.id];
              const p = c.parentId ? byId.get(c.parentId) : null;
              const py = c.parentId ? ys[c.parentId] : 0;
              if (y === undefined || (c.parentId && (!p || py === undefined))) return null;
              const base = baseOf(c.page);
              const ax = (p ? p.x : base.x) + c.relX;
              const ay = (p ? py! : base.y) + c.relY;
              const bx = c.x;
              const by = y + 24;
              const ex = p ? p.x + wOf(p) : base.x + (c.page ? PAGE_W : LESSON_W); // leave from the parent's edge, not across its text
              const m = Math.max(24, (bx - ex) / 2);
              return (
                <g key={c.id}>
                  <path d={`M${ex} ${ay} C${ex + m} ${ay}, ${bx - m} ${by}, ${bx} ${by}`} />
                  <circle cx={ax} cy={ay} r="3.5" />
                </g>
              );
            })}
          </svg>

          {cards.map((c) => (
            <article
              key={c.id}
              ref={(el) => setCardEl(c.id, el)}
              className="cv-card"
              style={{ left: c.x, top: ys[c.id] ?? 0, width: wOf(c), height: c.h, visibility: ys[c.id] === undefined ? "hidden" : undefined }}
            >
              <header onPointerDown={(e) => startDrag(c, e)} title="Drag to move">
                <Term text={c.term} />
                <span className="cv-dots" aria-label={`Depth ${c.level} of 4`}>
                  {[1, 2, 3, 4].map((n) => (
                    <i key={n} className={n <= c.level ? "on" : c.status[n - 1] === "done" ? "ready" : ""} />
                  ))}
                </span>
                <button className="cv-x" onClick={() => removeCard(c.id)} aria-label={`Remove card for ${c.term}`}>
                  ✕
                </button>
              </header>
              <div className="cv-body" onMouseUp={(e) => onCardMouseUp(c, e)} onClick={(e) => onCardClick(c, e)}>
                {c.recall?.step === "ask" ? (
                  <div className="cv-recall">
                    <p className="cv-seen">
                      You opened this {c.from?.createdAt ? new Date(c.from.createdAt).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" }) : "before"} · depth {c.level}
                    </p>
                    <p>
                      <b>Recall first:</b> {c.recall.q ?? <span className="cv-wait">a question is coming…</span>}
                    </p>
                    <div>
                      <button className="cv-show" onClick={() => showOld(c)}>
                        Show my card
                      </button>
                      <button className="cv-skip" onClick={() => answerRecall(c, null)}>
                        Skip
                      </button>
                    </div>
                  </div>
                ) : (
                [1, 2, 3, 4].slice(0, c.level).map((lv) => (
                  <section key={lv} className={`cv-part cv-l${lv}`}>
                    {lv > 1 && <h4>{LEVEL_NAME[lv]}</h4>}
                    <Part level={lv} text={c.parts[lv - 1]} status={c.status[lv - 1]} />
                    {c.status[lv - 1] === "error" && (
                      <button className="cv-mini" onClick={() => retry(c, lv)}>
                        Try again
                      </button>
                    )}
                    {lv === 4 && c.status[3] === "done" && (
                      <p className="cv-note">
                        Drawn by the tutor for this passage; check it against the text.{" "}
                        <button className="cv-mini" onClick={() => retry(c, 4)}>
                          Redraw
                        </button>
                      </p>
                    )}
                  </section>
                ))
                )}
              </div>
              {c.recall?.step === "had" && (
                <p className="cv-had">
                  Had it?{" "}
                  <button onClick={() => answerRecall(c, true)}>yes</button>{" "}
                  <button onClick={() => answerRecall(c, false)}>no</button>
                </p>
              )}
              {c.recall?.had === false && <p className="cv-had">It’ll come back in a warm-up.</p>}
              {c.level < 4 && c.recall?.step !== "ask" && (
                <button className="cv-deeper" onClick={() => deepen(c, c.level + 1)}>
                  Zoom in: {LEVEL_NAME[c.level + 1].toLowerCase()} <span aria-hidden="true">＋</span>
                </button>
              )}
              <span
                className="cv-grip"
                onPointerDown={(e) => startResize(c, e)}
                onDoubleClick={() => fitCard(c)}
                title="Drag to resize · double-click to fit"
                aria-hidden="true"
              />
            </article>
          ))}
          {pick &&
            (() => {
              const base = pick.parent ? { x: pick.parent.x, y: ys[pick.parent.id] } : (pick.page ?? { x: 0, y: 0 });
              if (base.y === undefined) return null;
              return (
                <div
                  className="cv-pick"
                  style={{ left: base.x + pick.relX + 4, top: base.y + pick.relY + 12 }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  <button onClick={() => explore(pick)}>Explore</button>
                  <span>Ask</span>
                  {(Object.keys(LEVEL_LABEL) as TutorLevel[]).map((lv) => (
                    <button key={lv} onClick={() => askTutor(pick, lv)}>
                      {LEVEL_LABEL[lv]}
                    </button>
                  ))}
                </div>
              );
            })()}
        </div>

        <ReturnPanel courseSlug={courseSlug} courseTitle={courseTitle} lessonSlug={lessonSlug} lessonTitle={lessonTitle} view="canvas" />
        <div className="cv-hud">
          {canBack && (
            <button onClick={goBack} className="cv-back">
              ← Back to where I was <kbd>Esc</kbd>
            </button>
          )}
          <button onClick={() => zoomStep(-1, vpRef.current!.clientWidth / 2, vpRef.current!.clientHeight / 2)} aria-label="Zoom out">
            −
          </button>
          <button
            onClick={() => {
              // back to 100%, keeping the same spot under the middle of the screen
              const r = vpRef.current!.getBoundingClientRect();
              const v = viewRef.current;
              setEase("glide");
              setView({ k: 1, x: 40, y: r.height / 2 - (r.height / 2 - v.y) / v.k });
            }}
            aria-label="Reset zoom to 100%"
          >
            {Math.round(view.k * 100)}%
          </button>
          <button onClick={() => zoomStep(1, vpRef.current!.clientWidth / 2, vpRef.current!.clientHeight / 2)} aria-label="Zoom in">
            ＋
          </button>
        </div>
        {cards.length === 0 && !hintGone && (
          <p className="cv-hint">
            <button className="cv-x" onClick={hideHint} aria-label="Hide these tips">
              ✕
            </button>
            Highlight a word or phrase and press Explore to open a card, or Ask (Simple, Mid, Deep) to put the question to the tutor in the margin. Holding Alt while you highlight (or Alt + click on one word) opens it at once. Scroll to move (Shift + scroll goes sideways). To deepen a
            card, click its Zoom in bar, or hold Ctrl and scroll over it. Drag a card by its title; resize it from its corner.
            A link to another lesson or cheat sheet opens beside this one.
          </p>
        )}
      </div>
        <TutorPanel
          ref={tutor}
          courseSlug={courseSlug}
          courseTitle={courseTitle}
          lessonSlug={lessonSlug}
          lessonTitle={lessonTitle}
          view="canvas"
          open={tutorOpen}
          setOpen={setTutorOpen}
        />
      </div>
    </div>
  );
}
