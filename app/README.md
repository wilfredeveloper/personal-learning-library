# The app

Next.js (App Router) · TypeScript · Tailwind v4. Install and usage are in the [top-level README](../README.md).

- `scripts/sync-courses.mjs` publishes every course in the library into `public/courses/` and writes `content/embedded-courses.json` (both generated, not in git).
- `scripts/digest.mjs` writes a course's gap summary for the teacher; `scripts/check-links.mjs` checks a course's links; `scripts/lesson-job.mjs` runs "Ask for the next lesson".
- Claude calls go through the local `claude` CLI (`lib/claude.ts`, `app/api/*`), so the app must run on the same machine as Claude Code.
- The library location: `LEARNING_DIR` in `.env.local` (written by `install.sh`), else `~/learning-library`.
