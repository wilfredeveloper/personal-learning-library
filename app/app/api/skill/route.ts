import { SKILL_DIR, SkillError, commitAll, isRepo, listFiles, log, readFile, revert, save, show, status } from "@/lib/skill";
import { isLocalRequest, notLocal } from "@/lib/local";

// The teach skill folder (WP11). Local only; writes only inside SKILL_DIR.
//   GET                 -> { dir, repo, files, status: { lines, diff }, log }
//   GET ?file=SKILL.md  -> { file, text }
//   GET ?commit=<hash>  -> { commit, diff }
//   POST { action: "save", file, base, text, message } -> { commit }
//   POST { action: "commitAll", message }              -> { commit }
//   POST { action: "revert", hash }                    -> { commit }
// Errors: { error } with 400 (bad input), 404, 409 (not a repo, changed on disk, conflict) or 500.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function fail(e: unknown) {
  if (e instanceof SkillError) return Response.json({ error: e.message }, { status: e.status });
  const code = (e as { code?: string }).code;
  if (code === "ENOENT") return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  try {
    if (q.has("file")) return Response.json({ file: q.get("file"), text: await readFile(q.get("file")) });
    if (q.has("commit")) return Response.json({ commit: q.get("commit"), diff: await show(q.get("commit")) });
    const repo = await isRepo();
    return Response.json({
      dir: SKILL_DIR,
      repo,
      files: await listFiles(),
      status: repo ? await status() : { lines: [], diff: "" },
      log: repo ? await log() : [],
    });
  } catch (e) {
    return fail(e);
  }
}

export async function POST(req: Request) {
  if (!isLocalRequest(req)) return notLocal(); // changes files or spends money: this machine only (see lib/local.ts)
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object") throw new SkillError("JSON body expected");
    switch (body.action) {
      case "save":
        return Response.json({ commit: await save(body.file, body.base, body.text, body.message) });
      case "commitAll":
        return Response.json({ commit: await commitAll(body.message) });
      case "revert":
        return Response.json({ commit: await revert(body.hash) });
      default:
        throw new SkillError("unknown action");
    }
  } catch (e) {
    return fail(e);
  }
}
