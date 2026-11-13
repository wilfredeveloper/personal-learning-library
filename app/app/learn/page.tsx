import Link from "next/link";
import { embeddedCourses } from "@/lib/embedded";
import CourseShelf from "@/components/CourseShelf";

export const metadata = { title: "The library — Learn" };

export default function LearnIndex() {
  const totalLessons = embeddedCourses.reduce((n, c) => n + c.lessons.length, 0);

  return (
    <div className="lib-breakout">
      <div className="lib">
        <header className="lib-titlebar">
          <div>
            <p className="lib-eyebrow">Notebook</p>
            <h1>The library</h1>
          </div>
          <div>
            <p>
              Interactive lessons, one course at a time. Highlight anything you don&apos;t follow and
              ask the tutor, right in the page.
            </p>
            <Link
              href="/learn/history"
              className="mt-3 inline-block font-sans text-sm font-medium text-accent no-underline hover:underline"
            >
              Your tutor questions →
            </Link>
          </div>
        </header>

        <div className="section-label">
          <p>Courses</p>
          <span>
            {embeddedCourses.length} courses · {totalLessons} lessons
          </span>
        </div>

        <CourseShelf
          courses={embeddedCourses.map((c) => ({
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
          }))}
        />
      </div>
    </div>
  );
}
