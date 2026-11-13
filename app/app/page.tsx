import { embeddedCourses } from "@/lib/embedded";
import CourseShelf, { type ShelfCourse } from "@/components/CourseShelf";

export default function Home() {
  const built: ShelfCourse[] = embeddedCourses.map((c) => ({
    slug: c.slug,
    href: `/learn/${c.slug}`,
    title: c.title,
    blurb: c.lessons[0]?.lede ?? "",
    meta: [`${c.lessons.length} lessons`, `${c.reference.length} cheat sheets`],
    lessons: c.lessons.map((l) => ({
      title: l.title,
      href: `/learn/${c.slug}/${l.slug}`,
      minutes: l.minutes,
    })),
  }));
  const all = built;
  const total = all.reduce((n, c) => n + c.lessons.length, 0);

  return (
    <div className="lib-breakout">
      <div className="lib">
        <header className="lib-titlebar">
          <div>
            <p className="lib-eyebrow">Personal notebook</p>
            <h1>Learn</h1>
          </div>
          <p>
            Lessons written for one reader, one course at a time, by Claude Code&apos;s /teach.
            Pick up where you left off.
          </p>
        </header>

        <div className="section-label">
          <p>Courses</p>
          <span>
            {all.length} courses · {total} lessons
          </span>
        </div>

        <CourseShelf courses={all} />
      </div>
    </div>
  );
}
