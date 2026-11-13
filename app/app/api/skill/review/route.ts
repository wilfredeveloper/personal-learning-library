import { promises as fs } from "node:fs";
import path from "node:path";
import { claudeOnce } from "@/lib/claude";
import { LEARNING } from "@/lib/paths";
import { listFiles } from "@/lib/skill";
import { unifiedDiff } from "@/lib/skill-diff";
import { isLocalRequest, notLocal } from "@/lib/local";

// Review an edit to the teach skill (WP11) before saving it.
//   POST { file, old, new } -> { conflicts: string[], vaguer: string[], wouldStopDoing: string[], summary: string }
// One Sonnet call, checked against the learning workspace's house rules (CLAUDE.md) and
// LEARNER.md. Advisory only: nothing here writes, and saving never waits on a review.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SYSTEM =
  "You review edits to a Claude Code skill that builds lessons for one learner. Judge only the edit shown, " +
  "against the house rules and learner profile given. Be specific and short; quote the instruction you mean. " +
  "Reply with strict JSON only, no prose and no code fences.";

const cap = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n[… trimmed]` : s);

async function read(file: string) {
  return fs.readFile(path.join(LEARNING, file), "utf8").catch(() => "");
}

/** The sections of the learning CLAUDE.md whose headings name house rules or house style. */
function houseRules(md: string) {
  const parts = md.split(/^(?=## )/m).filter((p) => /^## .*house/i.test(p));
  return parts.join("\n").trim();
}

type Review = { conflicts: string[]; vaguer: string[]; wouldStopDoing: string[]; summary: string };

function parse(raw: string): Review | null {
  const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
  if (s < 0 || e < s) return null;
  try {
    const j = JSON.parse(raw.slice(s, e + 1));
    const list = (x: unknown) => (Array.isArray(x) ? x.filter((v) => typeof v === "string" && v.trim()).map((v: string) => v.trim()) : []);
    return { conflicts: list(j.conflicts), vaguer: list(j.vaguer), wouldStopDoing: list(j.wouldStopDoing), summary: typeof j.summary === "string" ? j.summary.trim() : "" };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return notLocal(); // changes files or spends money: this machine only (see lib/local.ts)
  const body = await req.json().catch(() => null);
  const file = body?.file, oldText = body?.old, newText = body?.new;
  if (typeof file !== "string" || typeof oldText !== "string" || typeof newText !== "string")
    return Response.json({ error: "file, old and new expected" }, { status: 400 });
  if (!(await listFiles()).includes(file)) return Response.json({ error: "not a skill file" }, { status: 400 });
  const diff = unifiedDiff(file, oldText, newText);
  if (!diff) return Response.json({ error: "no changes to review" }, { status: 400 });

  const prompt = [
    `File: ${file} (part of the teach skill)`,
    "",
    "<house_rules source=\"learning/CLAUDE.md\">",
    cap(houseRules(await read("CLAUDE.md")), 8000),
    "</house_rules>",
    "",
    "<learner source=\"learning/LEARNER.md\">",
    cap(await read("LEARNER.md"), 5000),
    "</learner>",
    "",
    "<file_before_edit>",
    cap(oldText, 16000),
    "</file_before_edit>",
    "",
    "<diff>",
    cap(diff, 20000),
    "</diff>",
    "",
    "Review the diff. Return exactly this JSON object:",
    '{"conflicts": [], "vaguer": [], "wouldStopDoing": [], "summary": ""}',
    "- conflicts: ways the edited skill now contradicts a house rule or the learner profile.",
    "- vaguer: instructions the edit made less precise (a lost number, reason, example or condition).",
    "- wouldStopDoing: things Claude did under the old text that it would no longer do (only if not restated elsewhere in the file).",
    "- summary: one or two sentences on what the edit changes and whether it looks safe.",
    "Use empty arrays when there is nothing to say. Each item is one sentence.",
  ].join("\n");

  try {
    const raw = await claudeOnce({ feature: "skill.review", course: "_shared", model: "sonnet", system: SYSTEM, prompt, timeoutMs: 120_000 });
    const review = parse(raw);
    if (!review) return Response.json({ error: "Claude's reply wasn't the expected JSON", raw: raw.slice(0, 1000) }, { status: 502 });
    return Response.json(review);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
