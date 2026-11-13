import Link from "next/link";
import CourseArt from "@/components/CourseArt";

export type ShelfCourse = {
  slug: string;
  href: string;
  title: string;
  blurb: string;
  meta: string[];
  lessons: { title: string; href: string; minutes?: string | number }[];
};

const SHOWN = 5;

/** The course listing: each course is a spread of three blocks (title, cover
    art, first lessons). Three arrangements cycle down the page. */
export default function CourseShelf({ courses }: { courses: ShelfCourse[] }) {
  return (
    <div className="shelf">
      {courses.map((c, i) => (
        <article key={c.slug} className={`spread spread-${"abc"[i % 3]}`}>
          <div className="spread-title">
            <p className="entry-meta">
              <span>{String(i + 1).padStart(2, "0")}</span>
              {c.meta.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </p>
            <h2>
              <Link href={c.href}>{c.title}</Link>
            </h2>
            <p className="blurb">{c.blurb}</p>
            <Link href={c.href} className="spread-open">
              Open course <span aria-hidden="true">↗</span>
            </Link>
          </div>

          <Link href={c.href} className="spread-art" aria-label={`${c.title}: open course`}>
            <CourseArt slug={c.slug} title={c.title} />
            <span className="spread-plate">{c.slug}</span>
          </Link>

          <div className="spread-list">
            <p className="aside-heading">Lessons</p>
            <ol>
              {c.lessons.slice(0, SHOWN).map((l, j) => (
                <li key={l.href}>
                  <Link href={l.href}>
                    <small>{String(j + 1).padStart(2, "0")}</small>
                    <span>{l.title}</span>
                    {l.minutes ? <small>{l.minutes} min</small> : null}
                  </Link>
                </li>
              ))}
            </ol>
            {c.lessons.length > SHOWN && (
              <Link href={c.href} className="spread-more">
                + {c.lessons.length - SHOWN} more lessons
              </Link>
            )}
            {c.lessons.length === 0 && <p className="spread-none">No lessons yet.</p>}
          </div>
        </article>
      ))}
    </div>
  );
}
