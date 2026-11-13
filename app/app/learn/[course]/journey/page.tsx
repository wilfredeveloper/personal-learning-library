// Journey: an optional look back at a course (docs/journey/SCOPE.md, WP8). The server reads each
// lesson's section order from its HTML; the client fetches the events and draws them.
import { promises as fs } from "node:fs";
import path from "node:path";
import { notFound } from "next/navigation";
import { getEmbeddedCourse } from "@/lib/embedded";
import Journey from "@/components/journey/Journey";
import type { LessonOutline } from "@/components/journey/derive";
import "./journey.css";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Heading text as the browser's innerText would give it (events name sections that way). */
function headingText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) =>
      ent[0] === "#"
        ? String.fromCodePoint(ent[1].toLowerCase() === "x" ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10))
        : (ENTITIES[ent.toLowerCase()] ?? m),
    )
    .replace(/\s+/g, " ")
    .trim();
}

/** The lesson's sections in document order: the h1 (the part above the first h2), then each h2. */
async function sectionsOf(course: string, file: string): Promise<string[]> {
  const html = await fs.readFile(path.join(process.cwd(), "public", "courses", course, "lessons", file), "utf8").catch(() => "");
  const h1 = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  const h2s = [...html.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => headingText(m[1]));
  return [...(h1 ? [headingText(h1[1])] : []), ...h2s].filter((s, i, all) => s && all.indexOf(s) === i);
}

export default async function JourneyPage({ params }: { params: Promise<{ course: string }> }) {
  const { course } = await params;
  const c = getEmbeddedCourse(course);
  if (!c) notFound();
  const outline: LessonOutline[] = await Promise.all(
    c.lessons.map(async (l) => ({ slug: l.slug, title: l.title, sections: await sectionsOf(c.slug, l.file) })),
  );
  return <Journey course={c.slug} courseTitle={c.title} outline={outline} />;
}
