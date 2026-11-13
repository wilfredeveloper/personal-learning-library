import { redirect } from "next/navigation";

// The canvas used to live here while it was a prototype; it is now the lesson
// page itself. Old links and open tabs land on the right place.
export default async function OldCanvasPath({
  params,
}: {
  params: Promise<{ course: string; lesson: string }>;
}) {
  const { course, lesson } = await params;
  redirect(`/learn/${course}/${lesson}`);
}
