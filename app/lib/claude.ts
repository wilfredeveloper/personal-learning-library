import { spawn } from "node:child_process";
import { logCall } from "@/lib/calls";

// One-shot Claude call for small server-side jobs (warm-up questions, recall prompts):
// the machine's logged-in `claude` CLI, started lean like /api/explain (no tools, MCP
// servers, settings or default system prompt), waited on to the end, and logged to
// calls.jsonl. Server only. Rejects on failure or timeout; callers decide what to show.

export type OnceOptions = {
  feature: string; // calls.jsonl feature name, e.g. "warmup", "recall"
  course: string; // course slug
  model: string; // "haiku" | "sonnet" | "opus" or a full model id
  system: string;
  prompt: string;
  timeoutMs?: number; // default 60 s
};

export function claudeOnce(o: OnceOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    let result: { result?: unknown; is_error?: boolean } | null = null;
    let stderr = "";
    let buf = "";
    let settled = false;
    const finish = (error?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      logCall(result, { feature: o.feature, course: o.course, startedAt, firstTokenAt: result ? Date.now() : null, error });
      if (!error && result && !result.is_error && typeof result.result === "string") resolve(result.result);
      else reject(new Error(error ?? (typeof result?.result === "string" ? result.result : "claude returned no result")));
    };

    const child = spawn(
      "claude",
      [
        "-p", o.prompt,
        "--model", o.model,
        "--system-prompt", o.system,
        "--tools", "",
        "--strict-mcp-config",
        "--setting-sources", "",
        "--disable-slash-commands",
        "--no-session-persistence",
        "--output-format", "stream-json",
        "--verbose",
      ],
      { stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish("timeout");
    }, o.timeoutMs ?? 60_000);

    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        try {
          const ev = JSON.parse(line);
          if (ev.type === "result") result = ev;
        } catch {
          /* not a JSON line */
        }
      }
    });
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", (err) => finish(`spawn: ${err.message}`));
    child.on("close", (code) => finish(result ? undefined : stderr.trim().slice(0, 500) || `claude exited with code ${code}`));
  });
}
