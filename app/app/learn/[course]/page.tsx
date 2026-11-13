import Link from "next/link";
import { notFound } from "next/navigation";
import { getEmbeddedCourse } from "@/lib/embedded";
import NextLesson from "@/components/NextLesson";

export default async function CourseMap({
  params,
}: {
  params: Promise<{ course: string }>;
}) {
  const { course } = await params;
  const c = getEmbeddedCourse(course);
  if (!c) notFound();

  return (
    <div className="lib-breakout">
      <div className="lib">
        <header className="lib-titlebar course-head">
          <div>
            <Link href="/learn" className="back-link">
              ← All courses
            </Link>
            <p className="lib-eyebrow">Course · {c.lessons.length} lessons</p>
            <h1>{c.title}</h1>
          </div>
          <p>
            Work through in order. Highlight any passage inside a lesson to ask the tutor about it.
            <br />
            <Link href={`/learn/${c.slug}/journey`} style={{ color: "var(--accent)" }}>
              Journey: look back at what you’ve studied →
            </Link>
          </p>
        </header>

        <div className="archive-layout">
          <div className="archive-main">
            <NextLesson course={c.slug} />
            <div className="section-label">
              <p>Lessons, in order</p>
              <span>{c.lessons.length} entries</span>
            </div>
            <div className="index-list">
              {c.lessons.map((l, i) => (
                <Link key={l.slug} href={`/learn/${c.slug}/${l.slug}`} className="index-entry">
                  <div className="index-type">
                    <span className="big-num">{String(i + 1).padStart(2, "0")}</span>
                    <small>{l.eyebrow || `Lesson ${i + 1}`}</small>
                  </div>
                  <div className="index-copy">
                    <h2>{l.title}</h2>
                    <p>{l.lede}</p>
                  </div>
                  <div className="index-date">{l.minutes && <span>{l.minutes} min read</span>}</div>
                </Link>
              ))}
            </div>
          </div>

          {c.reference.length > 0 && (
            <aside className="archive-aside">
              <p className="aside-heading">Cheat sheets</p>
              <div className="aside-series">
                {c.reference.map((r) => (
                  <a
                    key={r.slug}
                    href={`/courses/${c.slug}/reference/${r.file}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span>{r.title}</span>
                    <small>ref ↗</small>
                  </a>
                ))}
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}
