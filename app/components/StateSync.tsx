"use client";

// Keeps lesson progress and tutor threads in step with the files under
// <library>/<course>/app-data/ (see app/api/state). On load the files win;
// the first time a browser syncs, its own localStorage data is merged in instead of
// being dropped. After that, every change is written back to its course's file.

import { useEffect } from "react";
import { useProgress } from "@/lib/store";
import { useTutor, type TutorThread } from "@/lib/tutor";

type Progress = ReturnType<typeof useProgress.getState>["byCourse"][string];
const FLAG = "learn.sync.v1";

const load = (name: string) =>
  fetch(`/api/state?name=${name}`).then((r) => (r.ok ? r.json() : null), () => null);
const save = (course: string, name: string, data: unknown) =>
  fetch("/api/state", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ course, name, data }) }).catch(() => {});

function mergeProgress(a: Progress | undefined, b: Progress): Progress {
  if (!a) return b;
  const completed = { ...a.completed };
  for (const [k, v] of Object.entries(b.completed)) completed[k] = completed[k] || v;
  return { completed, repDays: [...new Set([...a.repDays, ...b.repDays])].sort() };
}

const threadsOf = (ts: TutorThread[], course: string) => ts.filter((t) => t.course === course);

export default function StateSync() {
  useEffect(() => {
    let unsubs: (() => void)[] = [];
    let dead = false;
    (async () => {
      const [fileP, fileT] = (await Promise.all([load("progress"), load("tutor")])) as [
        Record<string, Progress> | null,
        Record<string, TutorThread[]> | null,
      ];
      if (dead || !fileP || !fileT) return; // server unreachable: stay browser-only
      let first = false;
      try {
        first = !localStorage.getItem(FLAG);
      } catch {}

      const byCourse = { ...useProgress.getState().byCourse };
      for (const [c, p] of Object.entries(fileP)) byCourse[c] = first ? mergeProgress(byCourse[c], p) : p;
      useProgress.setState({ byCourse });

      const local = useTutor.getState().threads;
      let threads = local.filter((t) => !(t.course in fileT));
      for (const [c, ts] of Object.entries(fileT)) {
        const ids = new Set(ts.map((t) => t.id));
        threads = threads.concat(ts, first ? threadsOf(local, c).filter((t) => !ids.has(t.id)) : []);
      }
      useTutor.setState({ threads: threads.sort((a, b) => b.createdAt - a.createdAt) });
      try {
        localStorage.setItem(FLAG, "1");
      } catch {}

      // what each file holds now; only changed courses are written
      const sentP = new Map(Object.entries(fileP).map(([c, p]) => [c, JSON.stringify(p)]));
      const sentT = new Map(Object.entries(fileT).map(([c, ts]) => [c, JSON.stringify(ts)]));
      const pushP = () => {
        const all = useProgress.getState().byCourse;
        for (const c of new Set([...Object.keys(all), ...sentP.keys()])) {
          const s = JSON.stringify(all[c] ?? { completed: {}, repDays: [] });
          if (sentP.get(c) !== s) {
            sentP.set(c, s);
            save(c, "progress", JSON.parse(s));
          }
        }
      };
      const pushT = () => {
        const all = useTutor.getState().threads;
        for (const c of new Set([...all.map((t) => t.course), ...sentT.keys()])) {
          const s = JSON.stringify(threadsOf(all, c));
          if (sentT.get(c) !== s) {
            sentT.set(c, s);
            save(c, "tutor", JSON.parse(s));
          }
        }
      };
      pushP();
      pushT();
      unsubs = [useProgress.subscribe(pushP), useTutor.subscribe(pushT)];
    })();
    return () => {
      dead = true;
      unsubs.forEach((u) => u());
    };
  }, []);
  return null;
}
