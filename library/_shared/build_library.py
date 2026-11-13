"""Rebuild the library front page (index.html in the library root).

Views (one page, switched by the URL hash):
  #            courses: a card per course folder
  #<folder>    one course: its lessons and cheat sheets
  #all         every lesson from every course, newest first

Run after adding or changing a lesson:  python3 <library>/_shared/build_library.py
A course is any folder with lessons/*.html. Nothing to configure.
"""
import datetime as dt
import html
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
e = html.escape


def text(fragment):
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", "", fragment))).strip()


def first(pattern, s):
    m = re.search(pattern, s, re.S)
    return text(m.group(1)) if m else ""


def shorten(s, n=200):
    if len(s) <= n:
        return s
    cut = s[:n].rfind(". ")  # keep whole sentences when we can
    return s[: cut + 1] if cut > 60 else s[: n - 3].rsplit(" ", 1)[0] + "…"


def fmt(d):
    return f"{d.day} {d.strftime('%B %Y')}"


def course_info(folder):
    hub = folder / "index.html"
    hub_html = hub.read_text() if hub.exists() else ""
    mission = (folder / "MISSION.md").read_text() if (folder / "MISSION.md").exists() else ""
    name = first(r"<h1[^>]*>(.*?)</h1>", hub_html)
    if not name and mission:
        name = mission.splitlines()[0].lstrip("# ").removeprefix("Mission:").strip()
    blurb = first(r'<p class="lede"[^>]*>(.*?)</p>', hub_html)
    if not blurb and mission:
        m = re.search(r"^## Why\s*\n+(.+?)(\n\n|\Z)", mission, re.S | re.M)
        blurb = m.group(1).replace("*", "").replace("\n", " ") if m else ""
    return name or folder.name.replace("-", " ").title(), blurb, ("index.html" if hub_html else None)


def lesson(path, slug, course):
    s = path.read_text()
    title = first(r"<h1[^>]*>(.*?)</h1>", s) or first(r"<title>(.*?)</title>", s)
    lede = first(r'<p class="lede"[^>]*>(.*?)</p>', s)
    if not lede:  # older lessons: first paragraph after the heading
        lede = first(r"<p[^>]*>(.*?)</p>", s[s.find("</h1>"):] if "</h1>" in s else s)
    m = re.match(r"(\d+)", path.name)
    num = int(m.group(1)) if m else 0
    return {
        "href": f"{slug}/lessons/{path.name}", "title": title, "lede": shorten(lede), "slug": slug, "course": course,
        "label": first(r'class="eyebrow"[^>]*>(.*?)</p>', s) or f"Lesson {num}",
        "minutes": first(r"<b>(\d+)\s*min</b>", s), "num": num,
        "date": dt.date.fromtimestamp(path.stat().st_mtime),
    }


courses = []
for folder in sorted(p for p in ROOT.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))):
    files = sorted((folder / "lessons").glob("*.html")) if (folder / "lessons").is_dir() else []
    if not files:
        continue
    name, blurb, hub = course_info(folder)
    lessons = [lesson(f, folder.name, name) for f in files]
    refs = [
        {"href": f"{folder.name}/reference/{r.name}",
         "title": first(r"<h1[^>]*>(.*?)</h1>", r.read_text()) or r.stem.split("-", 1)[-1].replace("-", " ").title()}
        for r in sorted((folder / "reference").glob("*.html"))
    ] if (folder / "reference").is_dir() else []
    courses.append({
        "slug": folder.name, "name": name, "blurb": blurb, "hub": hub and f"{folder.name}/{hub}",
        "lessons": lessons, "refs": refs, "updated": max(l["date"] for l in lessons),
    })

courses.sort(key=lambda c: c["updated"], reverse=True)
everything = sorted((l for c in courses for l in c["lessons"]), key=lambda l: (l["date"], l["num"]), reverse=True)


def entry(l, show_course):
    read = f'{l["minutes"]} min read' if l["minutes"] else "Lesson"
    side = f'<span>{e(l["course"])}</span><small>{e(l["label"])}</small>' if show_course else \
        f'<span class="big-num">{l["num"]:02d}</span><small>{e(l["label"])}</small>'
    return f'''
        <a class="index-entry" href="{e(l["href"])}">
          <div class="index-type">{side}</div>
          <div class="index-copy"><h2>{e(l["title"])}</h2><p>{e(l["lede"])}</p></div>
          <div class="index-date"><time datetime="{l["date"].isoformat()}">{fmt(l["date"])}</time><span>{read}</span></div>
        </a>'''


def card(c):
    n = len(c["lessons"])
    latest = max(c["lessons"], key=lambda l: (l["date"], l["num"]))
    return f'''
      <a class="course-card" href="#{e(c["slug"])}">
        <div class="course-mark" aria-hidden="true"><span>{n:02d}</span><small>{"lesson" if n == 1 else "lessons"}</small></div>
        <div class="course-copy">
          <p class="entry-meta"><span>{e(c["slug"])}</span><span>Updated {fmt(c["updated"])}</span></p>
          <h2>{e(c["name"])}</h2>
          <p>{e(shorten(c["blurb"], 170))}</p>
          <p class="course-latest"><small>Latest</small> {e(latest["title"])}</p>
        </div>
        <span class="course-go" aria-hidden="true">↗</span>
      </a>'''


def course_view(c):
    refs = "".join(f'<a href="{e(r["href"])}"><span>{e(r["title"])}</span><i>↗</i></a>' for r in c["refs"])
    hub = f'<a class="lib-link" href="{e(c["hub"])}">Course map <i>↗</i></a>' if c["hub"] else ""
    lessons = sorted(c["lessons"], key=lambda l: l["num"])
    return f'''
  <section class="view" data-view="{e(c["slug"])}" hidden>
    <header class="lib-titlebar course-head">
      <div><a class="back-link" href="#">← All courses</a><p class="eyebrow">Course · {len(lessons)} lesson{"s" if len(lessons) != 1 else ""}</p><h1>{e(c["name"])}</h1></div>
      <div><p>{e(c["blurb"])}</p>{hub}</div>
    </header>
    <div class="archive-layout">
      <div class="archive-main">
        <div class="section-label"><p>Lessons, in order</p><span>{len(lessons)} entries</span></div>
        <div class="index-list">{"".join(entry(l, False) for l in lessons)}
        </div>
      </div>
      <aside class="archive-aside" aria-label="Cheat sheets">
        <p class="aside-heading">Cheat sheets</p>
        <div class="aside-series">{refs or '<div><span class="muted">None yet</span></div>'}</div>
      </aside>
    </div>
  </section>'''


total = len(everything)
page = f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>My Learning Library</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;700&family=Gelasio:ital,wght@0,400;0,600;1,400&display=swap">
<link rel="stylesheet" href="_shared/assets/course.css">
<link rel="stylesheet" href="_shared/assets/library.css">
</head>
<body>
<main class="page lib">
  <nav class="lib-nav" aria-label="Library">
    <a class="lib-logo" href="#">Library<span aria-hidden="true">↗</span></a>
    <div class="lib-links"><a href="#" data-nav="home">Courses</a><a href="#all" data-nav="all">All lessons</a></div>
  </nav>

  <section class="view" data-view="home">
    <header class="lib-titlebar">
      <div><p class="eyebrow">Notebook</p><h1>My learning</h1></div>
      <p>Lessons written for me, one course at a time: how models work, the systems I build, and the mind that studies them.</p>
    </header>
    <div class="section-label"><p>Courses</p><span>{len(courses)} courses · {total} lessons</span></div>
    <div class="course-list">{"".join(card(c) for c in courses)}
    </div>
  </section>
{"".join(course_view(c) for c in courses)}
  <section class="view" data-view="all" hidden>
    <header class="lib-titlebar">
      <div><a class="back-link" href="#">← All courses</a><p class="eyebrow">Archive</p><h1>All lessons</h1></div>
      <p>Every lesson from every course, newest first.</p>
    </header>
    <div class="section-label"><p>All lessons</p><span>{total} entries</span></div>
    <div class="index-list">{"".join(entry(l, True) for l in everything)}
    </div>
  </section>

  <footer class="lib-footer"><span>Library</span><span>Rebuilt {fmt(dt.date.today())}</span></footer>
</main>
<script>
(() => {{
  const views = document.querySelectorAll(".view");
  const show = () => {{
    const want = location.hash.slice(1);
    const match = [...views].some((v) => v.dataset.view === want);
    const id = match ? want : "home";
    views.forEach((v) => (v.hidden = v.dataset.view !== id));
    document.querySelectorAll("[data-nav]").forEach((a) => a.toggleAttribute("aria-current", a.dataset.nav === (id === "all" ? "all" : "home")));
    window.scrollTo(0, 0);
  }};
  addEventListener("hashchange", show);
  show();
}})();
</script>
</body>
</html>
'''
(ROOT / "index.html").write_text(page)
print(f"index.html: {len(courses)} courses, {total} lessons")
