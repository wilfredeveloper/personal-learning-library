"use client";

// "Done for today" in the lesson's top bar, then the optional one line "Anything still
// unclear?" (docs/journey/SCOPE.md, WP6). Never opens by itself; Save logs a `note` only
// when there is text, Skip logs nothing.

import { useEffect, useRef, useState } from "react";
import { logEvent } from "@/lib/events";
import type { LessonPlace } from "@/components/ReturnPanel";
import "@/app/asks.css";

const MAX = 500;

export default function SessionEnd({ courseSlug, lessonSlug, view }: LessonPlace) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // A click anywhere else closes it, as Skip would.
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", away);
    return () => document.removeEventListener("pointerdown", away);
  }, [open]);

  function save() {
    const line = text.trim().slice(0, MAX);
    if (line) {
      logEvent(courseSlug, { kind: "note", lesson: lessonSlug, view, text: line });
      setSaved(true);
    }
    setText("");
    setOpen(false);
  }

  return (
    <div ref={rootRef} className="ask-end">
      <button className="ask-end-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {saved ? "Done for today ✓" : "Done for today"}
      </button>
      {open && (
        <form
          className="ask-pop"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setOpen(false);
            }
          }}
        >
          <label>
            Anything still unclear? <small>optional · one line</small>
            <input
              autoFocus
              value={text}
              maxLength={MAX}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. why the formula in section 2 has a minus sign"
            />
          </label>
          <div>
            <button type="submit" className="ask-go">
              Save
            </button>
            <button type="button" className="ask-skip" onClick={() => {
                setText("");
                setOpen(false);
              }}>
              Skip
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
