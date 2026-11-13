import type { Call } from "@/lib/calls";

// Pure summaries of calls.jsonl for the control room's Usage tab. No I/O; safe on the client.

export const FEATURE_WHAT: Record<string, string> = {
  "explain.1": "Canvas card · definition",
  "explain.2": "Canvas card · plain words",
  "explain.3": "Canvas card · how it works",
  "explain.4": "Canvas card · picture",
  "ask.simple": "Reader tutor · simple",
  "ask.mid": "Reader tutor · mid",
  "ask.deep": "Reader tutor · deep",
  warmup: "Warm-up questions",
  recall: "Recall questions",
  selftest: "Self-test",
};
const ORDER = Object.keys(FEATURE_WHAT);

export const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
export const usd = (x: number) => (x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`);
export const secs = (ms: number | null) => (ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`);

/** Local calendar day, YYYY-MM-DD. */
export const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** The first of the last `n` local days, today included. */
export function sinceDay(n: number, now = new Date()) {
  const d = new Date(now);
  d.setDate(d.getDate() - (n - 1));
  return dayKey(d);
}

// Time to first words: only calls where words arrived (ms_first is 0 when none did).
const firstOf = (cs: Call[]) => cs.filter((c) => c.ms_first > 0).map((c) => c.ms_first);
// Time to finish: successful calls only; a failure's duration is how long it took to fail.
const totalOf = (cs: Call[]) => cs.filter((c) => c.ok).map((c) => c.ms_total);
const sum = (cs: Call[]) => cs.reduce((n, c) => n + c.cost_usd, 0);

export type Group = { key: string; calls: number; cost: number; failed: number; first: number | null; total: number | null; models: string[] };

function group(calls: Call[], by: (c: Call) => string): Group[] {
  const m = new Map<string, Call[]>();
  for (const c of calls) {
    const k = by(c);
    m.set(k, [...(m.get(k) ?? []), c]);
  }
  return [...m].map(([key, cs]) => ({
    key,
    calls: cs.length,
    cost: sum(cs),
    failed: cs.filter((c) => !c.ok).length,
    first: median(firstOf(cs)),
    total: median(totalOf(cs)),
    models: [...new Set(cs.map((c) => c.model || "(unknown)"))].sort(),
  }));
}

export function summarize(calls: Call[], days: number, now = new Date()) {
  const byDay = new Map<string, { calls: number; cost: number }>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    byDay.set(dayKey(d), { calls: 0, cost: 0 });
  }
  for (const c of calls) {
    const b = byDay.get(dayKey(new Date(c.t)));
    if (b) {
      b.calls++;
      b.cost += c.cost_usd;
    }
  }
  const rank = (k: string) => (ORDER.includes(k) ? ORDER.indexOf(k) : ORDER.length);
  const failed = calls.filter((c) => !c.ok);
  return {
    calls: calls.length,
    cost: sum(calls),
    first: median(firstOf(calls)),
    failed: failed.length,
    days: [...byDay].map(([day, v]) => ({ day, ...v })),
    features: group(calls, (c) => c.feature).sort((a, b) => rank(a.key) - rank(b.key) || a.key.localeCompare(b.key)),
    courses: group(calls, (c) => c.course || "(none)").sort((a, b) => b.calls - a.calls || a.key.localeCompare(b.key)),
    slowest: calls.filter((c) => c.ok).sort((a, b) => b.ms_total - a.ms_total).slice(0, 5),
    failures: failed.sort((a, b) => b.t.localeCompare(a.t)),
  };
}
