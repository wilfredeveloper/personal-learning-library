// The control room: how the tutor is used (Usage), which model answers what (Models),
// and the teach skill that shapes the lessons (Teach skill). Local only.
import { Suspense } from "react";
import ControlRoom from "@/components/control/ControlRoom";
import "./control.css";

export const dynamic = "force-dynamic";
export const metadata = { title: "Control room" };

export default function ControlPage() {
  return (
    <Suspense>
      <ControlRoom />
    </Suspense>
  );
}
