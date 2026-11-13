import { spawn } from "node:child_process";
import { logCall } from "@/lib/calls";
import { modelFor } from "@/lib/models";

// Local-only tutor endpoint. Uses the machine's logged-in Claude Code
// subscription (the `claude` CLI) — no API key. Streams the answer back as
// plain text. The learner highlights a passage in a lesson and asks about it.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AskBody = {
  course?: string;
  courseSlug?: string;
  lesson?: string;
  heading?: string;
  selection?: string;
  context?: string;
  level?: string;
  question?: string;
  history?: { q: string; a: string }[];
};

// How deep the learner asked this highlight to be explained.
const LEVELS: Record<string, { style: string; ask: string }> = {
  simple: {
    style:
      "They asked for the SIMPLE version: explain it as you would to a bright friend with no background. " +
      "Everyday words, one concrete analogy or example, no formulas, and any jargon either avoided or " +
      "defined in a few words. Answer in 2–3 short paragraphs, grounded in the passage below.",
    ask: "Explain this passage as simply as you can — what it means and why it matters here.",
  },
  mid: {
    style:
      "They learn visually, their maths is rusty, and they want intuition before formalism. " +
      "Answer in 2–4 short paragraphs, concrete and plain, grounded in the passage below.",
    ask: "Explain this passage simply — what it means and why it matters here.",
  },
  deep: {
    style:
      "They asked for the DEEP version: they want the real mechanism, with the maths. " +
      "Use the proper vocabulary, show how each piece actually works, and include the formulas involved with " +
      "every symbol defined in words (write maths as plain text or inline code; the panel cannot typeset LaTeX). " +
      "A short derivation or worked numbers are welcome where they teach. Start with one sentence of intuition, " +
      "then go deep; up to about 6 paragraphs, grounded in the passage below.",
    ask: "Explain this passage in depth — the mechanism behind it, the maths, and why it matters here.",
  },
};

function buildPrompt(b: AskBody): string {
  const level = LEVELS[b.level ?? ""] ?? LEVELS.mid;
  const parts: string[] = [];
  parts.push(
    `You are the tutor for the course "${b.course ?? "this course"}". ` +
      `The learner is reading the lesson "${b.lesson ?? ""}"` +
      (b.heading ? `, in the section "${b.heading}".` : "."),
  );
  parts.push(
    level.style + " No preamble, no restating the question.",
  );
  if (b.selection) parts.push(`They highlighted this passage:\n"""\n${b.selection}\n"""`);
  if (b.context && b.context !== b.selection)
    parts.push(`Surrounding text, for context:\n"""\n${b.context}\n"""`);
  for (const turn of b.history ?? [])
    parts.push(`Earlier — they asked: ${turn.q}\nYou answered: ${turn.a}`);
  parts.push(
    b.question?.trim()
      ? `Their question: ${b.question.trim()}`
      : level.ask,
  );
  return parts.join("\n\n");
}

export async function POST(req: Request) {
  const body = (await req.json()) as AskBody;
  const prompt = buildPrompt(body);

  // stream-json only so the final "result" message (tokens, cost, model) can be logged
  // to calls.jsonl; the learner still gets the same text, all at once at the end, as with
  // the default text output.
  const model = await modelFor(`ask.${LEVELS[body.level ?? ""] ? (body.level as "simple" | "mid" | "deep") : "mid"}`);
  const child = spawn("claude", ["-p", prompt, "--model", model, "--output-format", "stream-json", "--verbose"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });

  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let result: unknown = null;
  let cancelled = false;
  let logged = false;
  const log = (error?: string) => {
    if (logged) return;
    logged = true;
    const level = LEVELS[body.level ?? ""] ? body.level : "mid";
    logCall(result, { feature: `ask.${level}`, course: body.courseSlug ?? body.course ?? "", startedAt, firstTokenAt, error });
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            if (ev.type === "result") {
              result = ev;
              firstTokenAt ??= Date.now();
              if (typeof ev.result === "string") controller.enqueue(new TextEncoder().encode(ev.result));
            }
          } catch {
            /* not a JSON line */
          }
        }
      });
      child.stdout.on("end", () => controller.close());
      child.on("error", (err) => {
        log(`spawn: ${err.message}`);
        controller.error(new Error(`Failed to run claude: ${err.message}`));
      });
      child.on("close", (code) => {
        log(result ? undefined : cancelled ? "aborted" : stderr.trim().slice(0, 500) || `claude exited with code ${code}`);
        if (code !== 0 && stderr) {
          try {
            controller.enqueue(new TextEncoder().encode(`\n\n[tutor error] ${stderr.trim()}`));
          } catch {
            /* already closed */
          }
        }
      });
    },
    cancel() {
      cancelled = true;
      child.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
