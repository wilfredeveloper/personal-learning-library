// Where the learning library lives, for the scripts (the Next app gets the same value from .env.local).
// Order: $LEARNING_DIR, then LEARNING_DIR in <app>/.env.local (written by install.sh), then ~/learning-library.
import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export function libraryDir() {
  if (process.env.LEARNING_DIR) return process.env.LEARNING_DIR;
  try {
    const env = readFileSync(path.join(import.meta.dirname, "..", ".env.local"), "utf8");
    const m = env.match(/^LEARNING_DIR=(.+)$/m);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {}
  return path.join(os.homedir(), "learning-library");
}
