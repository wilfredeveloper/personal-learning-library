import { spawn } from "node:child_process";
import { logCall } from "@/lib/calls";
import { modelFor } from "@/lib/models";

// Canvas tutor endpoint. One highlighted term, explained at one of
// four depths; the canvas asks for the next depth as the reader zooms in.
// Like /api/ask it uses the machine's logged-in `claude` CLI, but started lean
// (no MCP servers, tools, settings or default system prompt) and read as a
// token stream, so the first words arrive in about two seconds.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExplainBody = {
  course?: string; // course title, for the prompt
  courseSlug?: string; // for calls.jsonl
  lesson?: string;
  term?: string;
  context?: string;
  trail?: string[]; // the terms that led here, outermost first
  level?: number; // 1 definition · 2 plain words · 3 mechanism · 4 drawing
  prior?: string; // what this card already says at shallower depths
};

const SVG_RULES =
  "Output exactly one <svg> element and nothing else: no markdown fence, no commentary. " +
  'Use viewBox="0 0 640 400" and start with a full-size background <rect> filled #fbf9f3. ' +
  "No <script>, <style>, <foreignObject>, <image> or external references; style with inline attributes only. " +
  "Palette: ink #19221f, blue #234be7, coral #e0664f, lime #ddf59e, green #1f7a4d, sage #b9c8b4. " +
  'Text: font-family="Inter, sans-serif", font-size 13 or larger, short labels that never overlap shapes or each other. ' +
  "Draw the mechanism itself (the quantities, how they relate, what changes), not decoration, and label every part. " +
  "You may use <animate> or <animateTransform> where motion shows the idea. Keep it under about 70 elements.";

// The model for each level comes from models.json (lib/models.ts).
const LEVELS: Record<number, { system: string; ask: (t: string) => string }> = {
  1: {
    system:
      "You are a tutor writing margin notes for one learner. Reply with a single plain sentence of at most 28 words. " +
      "Start with the meaning itself: no preamble, no \"in this passage\", no markdown, and do not repeat the term. " +
      "If you name a symbol, write it as inline LaTeX between single dollar signs, e.g. $w_i$.",
    ask: (t) => `Define "${t}" as it is used in this passage.`,
  },
  2: {
    system:
      "You are a tutor writing margin notes for one learner. Explain in everyday words in two short paragraphs " +
      "of at most three sentences each, with one concrete example or analogy. No formulas, no headings, no preamble, " +
      "and do not repeat the definition already given. Bold the one idea that matters most, once.",
    ask: (t) => `Explain "${t}" in plain words: what it is and why it matters in this passage.`,
  },
  3: {
    system:
      "You are a tutor for a learner who wants the real mechanism, with the maths. " +
      "Use the proper vocabulary and show how it actually works. The page typesets LaTeX: write all maths as LaTeX, " +
      "inline between single dollar signs ($w \\cdot x$) and display equations on their own line between double dollar signs. " +
      "Never write maths as plain text (no sqrt(), w_i, 'times', or ASCII arrows). Use exactly this shape, without headings: " +
      "(1) the key formula as one display equation; " +
      "(2) a short bullet list starting with **Where:** that defines every symbol in one line each, with its units or shape when relevant; " +
      "(3) one worked example with small concrete numbers, as a display equation (use aligned steps if there are several); " +
      "(4) the intuition, at most two short paragraphs of at most three sentences each. " +
      "No preamble, and do not repeat what the earlier notes already said.",
    ask: (t) => `Explain the mechanism behind "${t}" in depth, as it applies in this passage.`,
  },
  4: {
    system: "You draw small, precise teaching diagrams as SVG. " + SVG_RULES,
    ask: (t) => `Draw a diagram that makes "${t}" click for the learner, as it is used in this passage.`,
  },
};

function buildPrompt(b: ExplainBody, ask: string): string {
  const parts: string[] = [];
  parts.push(`Course: "${b.course ?? ""}". Lesson: "${b.lesson ?? ""}".`);
  if (b.trail?.length) parts.push(`The learner got here by zooming into: ${b.trail.join(" → ")}.`);
  if (b.context) parts.push(`The passage:\n"""\n${b.context.slice(0, 1800)}\n"""`);
  if (b.prior?.trim()) parts.push(`Notes already shown for this term:\n"""\n${b.prior.slice(0, 2400)}\n"""`);
  parts.push(ask);
  return parts.join("\n\n");
}

export async function POST(req: Request) {
  const body = (await req.json()) as ExplainBody;
  const term = (body.term ?? "").trim().slice(0, 300);
  const levelNo = LEVELS[body.level ?? 1] ? (body.level ?? 1) : 1;
  const level = LEVELS[levelNo];
  if (!term) return new Response("Missing term", { status: 400 });

  const child = spawn(
    "claude",
    [
      "-p", buildPrompt(body, level.ask(term)),
      "--model", await modelFor(`explain.${levelNo as 1 | 2 | 3 | 4}`),
      "--system-prompt", level.system,
      "--tools", "",
      "--strict-mcp-config",
      "--setting-sources", "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--output-format", "stream-json",
      "--verbose",
      "--include-partial-messages",
    ],
    { stdio: ["ignore", "pipe", "pipe"], env: process.env },
  );
  // One calls.jsonl line per request, written when the CLI exits (or fails to start).
  const startedAt = Date.now();
  let firstTokenAt: number | null = null;
  let result: unknown = null; // the CLI's final {"type":"result"} message
  let aborted = false;
  let logged = false;
  const log = (error?: string) => {
    if (logged) return;
    logged = true;
    logCall(result, { feature: `explain.${levelNo}`, course: body.courseSlug ?? "", startedAt, firstTokenAt, error });
  };
  req.signal.addEventListener("abort", () => {
    aborted = true;
    child.kill("SIGTERM");
  });

  const enc = new TextEncoder();
  let stderr = "";
  child.stderr.on("data", (d) => (stderr += d.toString()));

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let buf = "";
      let sent = false;
      let closed = false;
      const send = (s: string) => {
        if (closed) return;
        sent = true;
        controller.enqueue(enc.encode(s));
      };
      const close = () => {
        if (closed) return;
        closed = true;
        controller.close();
      };
      child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let nl;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl);
          buf = buf.slice(nl + 1);
          if (!line.trim()) continue;
          try {
            const ev = JSON.parse(line);
            const d = ev.type === "stream_event" ? ev.event : null;
            if (d?.type === "content_block_delta" && d.delta?.type === "text_delta") {
              firstTokenAt ??= Date.now();
              send(d.delta.text);
            } else if (ev.type === "result") {
              result = ev;
              if (ev.is_error) send(`\n\n[tutor error] ${ev.result ?? "failed"}`);
            }
          } catch {
            /* not a JSON line */
          }
        }
      });
      child.on("error", (err) => {
        send(`\n\n[tutor error] Could not run claude: ${err.message}`);
        log(`spawn: ${err.message}`);
        close();
      });
      child.on("close", (code) => {
        if (code !== 0 && !sent) send(`\n\n[tutor error] ${stderr.trim() || `claude exited with code ${code}`}`);
        log(result ? undefined : aborted ? "aborted" : stderr.trim().slice(0, 500) || `claude exited with code ${code}`);
        close();
      });
    },
    cancel() {
      aborted = true;
      child.kill("SIGTERM");
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
