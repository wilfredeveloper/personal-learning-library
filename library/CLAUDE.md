# Learning library (all /teach courses live here)

This folder is the single home for everything the `/teach` skill makes. Any session can resume any
course from these files alone; nothing depends on old chat history.

Paths: this library is `{{LIBRARY_DIR}}`; the app is `{{APP_DIR}}` (both set by `install.sh`).

## Start of every teaching session
1. Read `LEARNER.md` (who the learner is, how they like to learn, house style). If it still says
   "not filled in yet", interview the learner first (5 short questions at most: what they want to learn and why,
   what they already know, how they like to learn, maths comfort, time per session) and write it.
2. Read `PROGRESS.md` to see where each course stands and what's next.
3. Open the course folder and read its `MISSION.md`, `NOTES.md` and `learning-records/` before teaching.
   The course folder is the teach workspace (MISSION, RESOURCES, NOTES, learning-records, lessons, reference, assets).
   Also read `app-data/` if it exists: the app writes what the learner did there:
   `canvas/<lesson>.json` (every term they opened a card on, how deep they went), `tutor.json` (highlight
   questions and answers), `progress.json` (lessons done), `events.jsonl` (everything else).
   Terms they had to look up are evidence of gaps; use them to pick the next lesson.
   These files are written by the app; don't hand-edit them.
4. Run `node {{APP_DIR}}/scripts/digest.mjs <course>` and read `app-data/digest.md` before choosing
   the next lesson: ranked gaps (failed recalls, "not yet" answers, terms opened again, quiz misses after long
   reads), the learner's questions and notes verbatim, long card chains (a skipped prerequisite) and quiz misses.
5. If the learner owes answers from the last lesson (quiz results, "your turn" prompts), ask for those first,
   then write a learning record. Then build ONE lesson per request.
6. Check every external link you wrote: `node {{APP_DIR}}/scripts/check-links.mjs <course> <files…>`
   (prints CANVAS, TAB or UNCHECKED per link; see the skill's "Every link must open").
7. At the end, update the course's `NOTES.md` log, its `index.html`, and the course's row in `PROGRESS.md`,
   rebuild the library front page: `python3 {{LIBRARY_DIR}}/_shared/build_library.py`,
   and publish into the app: `cd {{APP_DIR}} && pnpm sync`.

## Courses
| Folder | Course |
|---|---|
| `how-llms-work/` | How LLMs work, built from scratch: companion to github.com/w3cj/how-llms-work (demo course) |

New course: `mkdir <slug>`, then `ln -s ../_shared/assets <slug>/assets`, and link `../assets/course.css`
from lessons (`assets/course.css` from the course's `index.html`). Add a row above and in `PROGRESS.md`.
Copy `how-llms-work/index.html` as the starting point for a new course's `index.html`.

## The library front page
`index.html` here is the library, with three views switched by the URL hash:
`#` course cards (one per course folder), `#<folder>` one course's lessons in order plus its cheat sheets,
and `#all` every lesson newest first.
It is generated: never edit it by hand, run `_shared/build_library.py`. The script reads each lesson's
`<h1>`, `.lede`, `.eyebrow` and `<b>N min</b>`, and the course name from the course `index.html` `<h1>`
(or `MISSION.md`). Its own styles are in `_shared/assets/library.css`.
The app reads the same fields when it publishes a course, so keep them in every lesson.

## House style (shared assets)
- Look: a centred 760px column, Inter headings, Georgia prose (Gelasio as the web fallback), IBM Plex Mono
  labels, sage paper #f4f6f2, ultramarine accent #234be7, lime highlight #ddf59e, square-ish rules and borders,
  sidenotes in the right margin. Light and dark themes; works at phone width.
  Every lesson head links the Google Fonts line for Inter + IBM Plex Mono + Gelasio (copy it from the demo lesson),
  and lessons/reference pages start their `.crumbs` nav with `<a href="../../index.html">Library</a>`.
- `_shared/assets/` is the one copy of `course.css`, `quiz.js`, `matmul.js`, `pipeline.js` (per-course maps via
  `data-map`; add your course's map in the file), `tokenbars.js`, `streamlab.js`, `editlab.js`, `actplot.js`.
  Each course has `assets -> ../_shared/assets`, so relative links work locally and in the app.
- Add reusable components there. Never restyle an existing class in a way that changes other courses' lessons;
  add a new class instead.
- Every lesson: one tangible win, a spaced warm-up from an earlier lesson, quizzes (`.quiz`, see `quiz.js`) with
  equal-length options and hints on wrong answers, a "recall tomorrow" prompt, one primary source, cited links,
  and an "ask me" box. Each lesson gets a reference cheat sheet in `reference/`.
- The demo lesson `how-llms-work/lessons/0001-same-pipe-different-brain.html` is the reference for markup.

## Depth & formulas
Follow `LEARNER.md` for how much maths the learner wants. When a lesson has formulas:
- Typeset them with KaTeX, with **every symbol defined in words** in a `.gloss` line right beside the equation.
  Display math goes in `<div class="eq">\[ … \]</div>`; inline is `\( … \)`.
- Copy the three KaTeX `<link>/<script>` head lines from the demo lesson (jsDelivr CDN). KaTeX renders from a CDN,
  so math needs internet at read time and degrades to readable raw TeX offline. Do NOT enable `$…$` as a delimiter.
- Start from what the learner knows; build each symbol up. Keep lessons short; dense, not long.

## Viewing
- In the app: `cd {{APP_DIR}} && pnpm dev`, then http://localhost:3000.
- Without the app: open `index.html` here, or any lesson file, in a browser.
