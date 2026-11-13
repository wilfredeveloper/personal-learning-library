import { notFound } from "next/navigation";
import { getEmbeddedCourse, getEmbeddedLesson } from "@/lib/embedded";
// The classic reader: the lesson with the tutor side panel. The canvas is the default view.
import LessonReader from "@/components/LessonReader";

export default async function LessonReaderPage({
  params,
}: {
  params: Promise<{ course: string; lesson: string }>;
}) {
  const { course, lesson } = await params;
  const c = getEmbeddedCourse(course);
  const l = getEmbeddedLesson(course, lesson);
  if (!c || !l) notFound();

  const idx = c.lessons.findIndex((x) => x.slug === lesson);
  const prev = idx > 0 ? c.lessons[idx - 1] : null;
  const next = idx < c.lessons.length - 1 ? c.lessons[idx + 1] : null;

  return (
    <LessonReader
      courseSlug={c.slug}
      courseTitle={c.title}
      lessonSlug={l.slug}
      lessonTitle={l.title}
      src={`/courses/${c.slug}/lessons/${l.file}`}
      prev={prev ? { slug: prev.slug, title: prev.title } : null}
      next={next ? { slug: next.slug, title: next.title } : null}
    />
  );
}
