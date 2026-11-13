import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

// Where the learning library lives: $LEARNING_DIR (install.sh writes it to .env.local),
// else ~/learning-library. Tests point it at a scratch copy so they never touch real data.
export const LEARNING = process.env.LEARNING_DIR || path.join(os.homedir(), "learning-library");

const COURSE = /^[a-z0-9-]+$/;

// A course is a plain folder in the learning root; "_shared" and the like are not courses.
export async function isCourse(course: string) {
  if (!COURSE.test(course) || course.startsWith("_")) return false;
  return fs.stat(path.join(LEARNING, course)).then((s) => s.isDirectory(), () => false);
}
