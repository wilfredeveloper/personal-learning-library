import { promises as fs } from "node:fs";
import path from "node:path";
import type { Call } from "@/lib/calls";
import { LEARNING } from "@/lib/paths";

// Claude call log for the control room's Usage tab: learning/_shared/app-data/calls.jsonl.
//   GET ?since=YYYY-MM-DD  -> { calls } made on or after that local day (default: the last 30 days)
// Lines that don't parse or lack the fields the tab reads are skipped.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FILE = () => path.join(LEARNING, "_shared", "app-data", "calls.jsonl");
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function parse(line: string): Call | null {
  try {
    const c = JSON.parse(line) as Call;
    if (!c || typeof c !== "object" || typeof c.t !== "string" || Number.isNaN(Date.parse(c.t))) return null;
    if (typeof c.feature !== "string" || typeof c.ok !== "boolean") return null;
    for (const k of ["ms_first", "ms_total", "in", "out", "cache_read", "cost_usd"] as const)
      if (typeof c[k] !== "number" || !Number.isFinite(c[k])) return null;
    return { ...c, model: typeof c.model === "string" ? c.model : "", course: typeof c.course === "string" ? c.course : "" };
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("since") ?? "";
  let since: number;
  if (DAY.test(q)) since = new Date(`${q}T00:00:00`).getTime(); // local midnight, same clock as the page
  else {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    since = d.setDate(d.getDate() - 29);
  }
  if (Number.isNaN(since)) return Response.json({ error: "bad since" }, { status: 400 });
  const text = await fs.readFile(FILE(), "utf8").catch(() => "");
  const calls: Call[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const c = parse(line);
    if (c && Date.parse(c.t) >= since) calls.push(c);
  }
  return Response.json({ calls });
}
