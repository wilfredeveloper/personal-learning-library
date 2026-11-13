import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// The teach skill (WP11, decision D5): the files in ~/.claude/skills/teach and the git repo
// that versions them. Server only. Every path is checked to stay inside SKILL_DIR, and git
// runs through execFile with argument arrays (no shell). Nothing here writes outside SKILL_DIR.

export const SKILL_DIR = process.env.SKILL_DIR ?? path.join(os.homedir(), ".claude", "skills", "teach");

const run = promisify(execFile);

export class SkillError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

/** The real folder (SKILL_DIR itself may be a symlink, as ~/.claude/skills/teach is). */
const root = () => fs.realpath(SKILL_DIR);

async function git(args: string[]) {
  const { stdout } = await run("git", ["-C", await root(), ...args], {
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
  });
  return stdout;
}

const gitErr = (e: unknown) => {
  const x = e as { stderr?: string; message?: string };
  return (x.stderr || x.message || String(e)).trim().slice(0, 800);
};

/** True only when SKILL_DIR is the top of its own repo (not a folder inside some other repo). */
export async function isRepo() {
  try {
    const top = (await git(["rev-parse", "--show-toplevel"])).trim();
    return (await fs.realpath(top)) === (await root());
  } catch {
    return false;
  }
}

const TEXT = /\.(md|ya?ml)$/;

/** Text files: *.md / *.yaml at the top level and in agents/. Regular files only, no symlinks. */
export async function listFiles(): Promise<string[]> {
  const r = await root();
  const out: string[] = [];
  for (const sub of ["", "agents"]) {
    const entries = await fs.readdir(path.join(r, sub), { withFileTypes: true }).catch(() => []);
    for (const e of entries) if (e.isFile() && TEXT.test(e.name)) out.push(sub ? `${sub}/${e.name}` : e.name);
  }
  return out.sort((a, b) => (a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b)));
}

/** Absolute path of a listed file, or a SkillError. Rejects absolute paths, `..`, unlisted names and anything resolving outside. */
async function resolveFile(name: unknown): Promise<string> {
  if (typeof name !== "string" || !name || name.includes("\0") || path.isAbsolute(name) || name.includes("\\") || name.split("/").some((p) => p === ".." || p === "." || p === ""))
    throw new SkillError("bad file name");
  if (!(await listFiles()).includes(name)) throw new SkillError("not a skill file");
  const r = await root();
  const real = await fs.realpath(path.join(r, name));
  if (!real.startsWith(r + path.sep)) throw new SkillError("outside the skill folder");
  return real;
}

export async function readFile(name: unknown) {
  return fs.readFile(await resolveFile(name), "utf8");
}

export type Commit = { hash: string; short: string; date: string; subject: string; root: boolean };

export async function log(): Promise<Commit[]> {
  const raw = await git(["log", "-n", "30", "--format=%H%x1f%h%x1f%aI%x1f%P%x1f%s"]).catch(() => "");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      const [hash, short, date, parents, subject] = l.split("\x1f");
      return { hash, short, date, subject, root: !parents };
    });
}

/** Uncommitted changes: `git status --porcelain` lines and the diff against HEAD (untracked files are listed, not diffed). */
export async function status() {
  const lines = (await git(["status", "--porcelain"])).split("\n").filter(Boolean);
  const diff = lines.length ? await git(["diff", "--no-color", "HEAD"]).catch(() => "") : "";
  return { lines, diff };
}

const HASH = /^[0-9a-f]{7,40}$/;

async function commitOf(hash: unknown) {
  if (typeof hash !== "string" || !HASH.test(hash)) throw new SkillError("bad commit hash");
  try {
    return (await git(["rev-parse", "--verify", "--quiet", `${hash}^{commit}`])).trim();
  } catch {
    throw new SkillError("no such commit", 404);
  }
}

export async function show(hash: unknown) {
  return git(["show", "--no-color", "--format=%H%n%an, %aI%n%n%B", await commitOf(hash), "--"]);
}

function checkMessage(message: unknown): string {
  if (typeof message !== "string" || !message.trim()) throw new SkillError("a commit message is needed");
  if (message.length > 2000) throw new SkillError("commit message too long");
  return message.trim();
}

async function needRepo() {
  if (!(await isRepo())) throw new SkillError(`${SKILL_DIR} is not a git repository; saving is off`, 409);
}

/**
 * Write one file and commit only that file. `base` is the text the editor started from:
 * if the file changed on disk since (an edit outside the app), nothing is written.
 */
export async function save(name: unknown, base: unknown, text: unknown, message: unknown) {
  await needRepo();
  const msg = checkMessage(message);
  if (typeof text !== "string" || typeof base !== "string") throw new SkillError("text missing");
  const file = await resolveFile(name);
  const rel = name as string;
  if ((await fs.readFile(file, "utf8")) !== base) throw new SkillError(`${rel} changed on disk since you opened it; reload it first`, 409);
  await fs.writeFile(file, text);
  try {
    await git(["add", "--", rel]);
    await git(["commit", "--quiet", "-m", msg, "--", rel]);
  } catch (e) {
    throw new SkillError(`git commit failed: ${gitErr(e)}`, 500);
  }
  return (await git(["rev-parse", "--short", "HEAD"])).trim();
}

/** Commit everything uncommitted in the skill folder (edits made by hand or by Claude). */
export async function commitAll(message: unknown) {
  await needRepo();
  const msg = checkMessage(message);
  if (!(await status()).lines.length) throw new SkillError("nothing to commit");
  try {
    await git(["add", "-A", "--", "."]);
    await git(["commit", "--quiet", "-m", msg]);
  } catch (e) {
    throw new SkillError(`git commit failed: ${gitErr(e)}`, 500);
  }
  return (await git(["rev-parse", "--short", "HEAD"])).trim();
}

/** `git revert --no-edit`; a conflicting revert is aborted and reported, leaving the folder as it was. */
export async function revert(hash: unknown) {
  await needRepo();
  const full = await commitOf(hash);
  const parents = (await git(["rev-list", "--parents", "-n", "1", full])).trim().split(" ").length - 1;
  if (parents !== 1) throw new SkillError(parents === 0 ? "the first commit can't be reverted (it would delete the skill)" : "merge commits can't be reverted here");
  if ((await status()).lines.length) throw new SkillError("commit or discard the uncommitted changes first", 409);
  try {
    await git(["revert", "--no-edit", full]);
  } catch (e) {
    const why = gitErr(e);
    await git(["revert", "--abort"]).catch(() => {});
    throw new SkillError(`revert failed and was aborted: ${why}`, 409);
  }
  return (await git(["rev-parse", "--short", "HEAD"])).trim();
}
