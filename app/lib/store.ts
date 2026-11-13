"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useEffect, useState } from "react";

/** localStorage on the client, a no-op shim during SSR/prerender. */
const safeStorage = createJSONStorage(() =>
  typeof window !== "undefined"
    ? window.localStorage
    : { getItem: () => null, setItem: () => {}, removeItem: () => {} }
);

export function isoOf(d: Date): string {
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}
export function todayIso(): string {
  return isoOf(new Date());
}

type CourseProgress = {
  completed: Record<string, boolean>;
  repDays: string[]; // unique ISO dates, sorted ascending
};

const EMPTY: CourseProgress = { completed: {}, repDays: [] };

type ProgressState = {
  byCourse: Record<string, CourseProgress>;
  toggleLesson: (course: string, slug: string) => void;
  setLesson: (course: string, slug: string, done: boolean) => void;
  logRepToday: (course: string) => void;
  unlogRepToday: (course: string) => void;
  resetCourse: (course: string) => void;
};

function withCourse(
  s: ProgressState,
  course: string,
  fn: (cp: CourseProgress) => CourseProgress
): Partial<ProgressState> {
  const cur = s.byCourse[course] ?? EMPTY;
  return { byCourse: { ...s.byCourse, [course]: fn(cur) } };
}

export const useProgress = create<ProgressState>()(
  persist(
    (set) => ({
      byCourse: {},
      toggleLesson: (course, slug) =>
        set((s) =>
          withCourse(s, course, (cp) => ({
            ...cp,
            completed: { ...cp.completed, [slug]: !cp.completed[slug] },
          }))
        ),
      setLesson: (course, slug, done) =>
        set((s) =>
          withCourse(s, course, (cp) => ({
            ...cp,
            completed: { ...cp.completed, [slug]: done },
          }))
        ),
      logRepToday: (course) =>
        set((s) =>
          withCourse(s, course, (cp) => {
            const t = todayIso();
            return cp.repDays.includes(t)
              ? cp
              : { ...cp, repDays: [...cp.repDays, t].sort() };
          })
        ),
      unlogRepToday: (course) =>
        set((s) =>
          withCourse(s, course, (cp) => ({
            ...cp,
            repDays: cp.repDays.filter((d) => d !== todayIso()),
          }))
        ),
      resetCourse: (course) =>
        set((s) => ({ byCourse: { ...s.byCourse, [course]: EMPTY } })),
    }),
    { name: "learn.progress.v1", storage: safeStorage }
  )
);

/** Read one course's progress (never undefined). */
export function useCourseProgress(course: string): CourseProgress {
  return useProgress((s) => s.byCourse[course]) ?? EMPTY;
}

export function computeStreak(repDays: string[]): number {
  if (repDays.length === 0) return 0;
  const set = new Set(repDays);
  const cur = new Date();
  if (!set.has(isoOf(cur))) cur.setDate(cur.getDate() - 1);
  let streak = 0;
  while (set.has(isoOf(cur))) {
    streak++;
    cur.setDate(cur.getDate() - 1);
  }
  return streak;
}

export function lastNDays(
  repDays: string[],
  n: number
): { iso: string; done: boolean }[] {
  const set = new Set(repDays);
  const out: { iso: string; done: boolean }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const iso = isoOf(d);
    out.push({ iso, done: set.has(iso) });
  }
  return out;
}

/** SSR/hydration guard: false on server + first client render, true after mount. */
export function useHasMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}
