import { promises as fs } from "node:fs";
import path from "node:path";
import { LEARNING } from "@/lib/paths";
import { FEATURES, MODELS, type Model, getSettings, saveSettings, validate } from "@/lib/models";
import type { Call } from "@/lib/calls";
import { isLocalRequest, notLocal } from "@/lib/local";

// Model routing settings (lib/models.ts) for the control room's Models tab.
//   GET                -> { models, prefetchPictures } with defaults filled in
//   GET ?measured=1    -> the same plus `measured`: medians per feature and model from
//                         calls.jsonl over the last 30 days, and what explain.4 calls cost
//   PUT { models?, prefetchPictures? } -> saves; 400 on unknown features, models or keys

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS = 30;

type Stat = { n: number; first: number; total: number; cost: number }; // medians: ms, ms, USD per call

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// "claude-haiku-4-5-20251001" -> "haiku"
const family = (id: string) => MODELS.find((m) => id.includes(m));

async function measured() {
  let text = "";
  try {
    text = await fs.readFile(path.join(LEARNING, "_shared", "app-data", "calls.jsonl"), "utf8");
  } catch {
    /* no calls yet */
  }
  const since = Date.now() - DAYS * 86_400_000;
  const groups = new Map<string, Call[]>();
  const pictures = { calls: 0, cost: 0 };
  for (const line of text.split("\n")) {
    let c: Call;
    try {
      c = JSON.parse(line);
    } catch {
      continue;
    }
    if (!c || !(Date.parse(c.t) >= since)) continue;
    if (c.feature === "explain.4") {
      pictures.calls++;
      pictures.cost += c.cost_usd || 0;
    }
    const fam = family(c.model ?? "");
    if (!c.ok || !fam || !(FEATURES as string[]).includes(c.feature)) continue;
    const key = `${c.feature}|${fam}`;
    groups.set(key, [...(groups.get(key) ?? []), c]);
  }
  const stats: Record<string, Partial<Record<Model, Stat>>> = {};
  for (const [key, cs] of groups) {
    const [f, m] = key.split("|") as [string, Model];
    (stats[f] ??= {})[m] = {
      n: cs.length,
      first: median(cs.map((c) => c.ms_first)),
      total: median(cs.map((c) => c.ms_total)),
      cost: median(cs.map((c) => c.cost_usd)),
    };
  }
  return { days: DAYS, stats, pictures };
}

export async function GET(req: Request) {
  const settings = await getSettings();
  if (!new URL(req.url).searchParams.has("measured")) return Response.json(settings);
  return Response.json({ ...settings, measured: await measured() });
}

export async function PUT(req: Request) {
  if (!isLocalRequest(req)) return notLocal(); // changes files or spends money: this machine only (see lib/local.ts)
  const body = await req.json().catch(() => undefined);
  const err = validate(body);
  if (err) return Response.json({ error: err }, { status: 400 });
  return Response.json(await saveSettings(body));
}
