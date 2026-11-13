import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING } from "@/lib/paths";

// One line per Claude call in learning/_shared/app-data/calls.jsonl: which feature,
// which model, how fast and how many tokens. Read later by the control room's usage tab.
// Server only. Logging must never break a tutor answer, so nothing here throws.

export type Call = {
  t: string;
  feature: string; // "explain.1".."explain.4" | "ask.simple|mid|deep" | ...
  model: string;
  course: string;
  ms_first: number;
  ms_total: number;
  in: number;
  out: number;
  cache_read: number;
  cost_usd: number; // list-price equivalent; on a subscription not what is billed
  ok: boolean;
  error?: string;
};

export type CallMeta = {
  feature: string;
  course: string;
  startedAt: number; // Date.now() when the request started
  firstTokenAt: number | null; // Date.now() when the first text reached the client
  error?: string; // set when the call failed or was aborted
};

type Result = {
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  modelUsage?: Record<string, { outputTokens?: number }>;
};

const FILE = () => path.join(LEARNING, "_shared", "app-data", "calls.jsonl");
let chain: Promise<unknown> = Promise.resolve();

/** `result` is the CLI's final {"type":"result"} stream-json message, or null if none arrived. */
export function logCall(result: unknown, meta: CallMeta): void {
  try {
    const r = (result && typeof result === "object" ? result : {}) as Result;
    const u = r.usage ?? {};
    // modelUsage is keyed by model id; a call can touch more than one model, so take the one that wrote the most.
    const models = Object.entries(r.modelUsage ?? {}).sort((a, b) => (b[1].outputTokens ?? 0) - (a[1].outputTokens ?? 0));
    const now = Date.now();
    const error = meta.error ?? (!result ? "no result" : r.is_error ? String(r.result ?? "error").slice(0, 500) : undefined);
    const call: Call = {
      t: new Date(meta.startedAt).toISOString(),
      feature: meta.feature,
      model: models[0]?.[0] ?? "",
      course: meta.course,
      // Both timings are wall-clock from the request, so ms_first <= ms_total and they include CLI start-up.
      ms_first: meta.firstTokenAt ? meta.firstTokenAt - meta.startedAt : 0,
      ms_total: now - meta.startedAt,
      // "in" counts every input token not read from cache (fresh input plus cache writes).
      in: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      out: u.output_tokens ?? 0,
      cache_read: u.cache_read_input_tokens ?? 0,
      cost_usd: r.total_cost_usd ?? 0,
      ok: !error,
      ...(error ? { error } : {}),
    };
    const file = FILE();
    chain = chain
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.appendFile(file, JSON.stringify(call) + "\n");
      })
      .catch(() => {});
  } catch {
    /* never throw into the request */
  }
}
