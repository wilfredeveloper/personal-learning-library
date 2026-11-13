// Embedded courses published from the learning vault by scripts/sync-courses.mjs.
// The lesson HTML + assets live under public/courses/<slug>/; this manifest is
// just the index the app routes read.
import data from "../content/embedded-courses.json";

export type EmbeddedLesson = {
  file: string;
  slug: string;
  title: string;
  lede: string;
  minutes: string;
  eyebrow: string;
};
export type EmbeddedRef = { file: string; slug: string; title: string };
export type EmbeddedCourse = {
  slug: string;
  title: string;
  lessons: EmbeddedLesson[];
  reference: EmbeddedRef[];
};

export const embeddedCourses: EmbeddedCourse[] = (data as { courses: EmbeddedCourse[] }).courses;

export const getEmbeddedCourse = (slug: string) =>
  embeddedCourses.find((c) => c.slug === slug);

export const getEmbeddedLesson = (slug: string, lesson: string) =>
  getEmbeddedCourse(slug)?.lessons.find((l) => l.slug === lesson);
