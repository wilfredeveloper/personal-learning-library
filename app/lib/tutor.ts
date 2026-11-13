"use client";

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

const safeStorage = createJSONStorage(() =>
  typeof window !== "undefined"
    ? window.localStorage
    : { getItem: () => null, setItem: () => {}, removeItem: () => {} },
);

export type TutorLevel = "simple" | "mid" | "deep";
export const LEVEL_LABEL: Record<TutorLevel, string> = { simple: "Simple", mid: "Mid", deep: "Deep" };

export type TutorTurn = { q: string; a: string; at: number };

export type TutorThread = {
  id: string;
  course: string; // slug
  courseTitle: string;
  lesson: string; // slug
  lessonTitle: string;
  selection: string;
  heading: string;
  context: string;
  level?: TutorLevel; // absent on threads saved before depths existed (treated as mid)
  createdAt: number;
  turns: TutorTurn[];
};

type NewThread = Omit<TutorThread, "id" | "createdAt" | "turns">;

type TutorState = {
  threads: TutorThread[];
  startThread: (t: NewThread) => string;
  addTurn: (id: string, turn: TutorTurn) => void;
  deleteThread: (id: string) => void;
  clearAll: () => void;
};

export const useTutor = create<TutorState>()(
  persist(
    (set) => ({
      threads: [],
      startThread: (t) => {
        const id =
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : String(Date.now()) + Math.random().toString(36).slice(2);
        set((s) => ({
          threads: [{ ...t, id, createdAt: Date.now(), turns: [] }, ...s.threads],
        }));
        return id;
      },
      addTurn: (id, turn) =>
        set((s) => ({
          threads: s.threads.map((th) =>
            th.id === id ? { ...th, turns: [...th.turns, turn] } : th,
          ),
        })),
      deleteThread: (id) =>
        set((s) => ({ threads: s.threads.filter((th) => th.id !== id) })),
      clearAll: () => set({ threads: [] }),
    }),
    { name: "learn.tutor.v1", storage: safeStorage },
  ),
);

export function timeAgo(ts: number): string {
  const s = (Date.now() - ts) / 1000;
  if (s < 45) return "just now";
  const m = s / 60;
  if (m < 60) return `${Math.floor(m)}m ago`;
  const h = m / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  if (d < 7) return `${Math.floor(d)}d ago`;
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
