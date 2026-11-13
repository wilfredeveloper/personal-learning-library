"use client";

// Tab shell for /control. Each tab is its own component (WP9 Usage, WP10 Models, WP11 Teach skill).

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import UsageTab from "@/components/control/UsageTab";
import ModelsTab from "@/components/control/ModelsTab";
import SkillTab from "@/components/control/SkillTab";

const TABS = [
  { key: "usage", name: "Usage" },
  { key: "models", name: "Models" },
  { key: "skill", name: "Teach skill" },
];

export default function ControlRoom() {
  const tab = useSearchParams().get("tab") ?? "usage";
  const router = useRouter();
  const path = usePathname();
  return (
    <div className="lib-breakout">
      <div className="lib">
        <header className="lib-titlebar ctl-head">
          <div>
            <p className="lib-eyebrow">Control room</p>
            <h1>Control room</h1>
          </div>
          <p>How the tutor is used, which model answers what, and the skill that shapes how you’re taught.</p>
        </header>
        <nav className="ctl-tabs" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={tab === t.key ? "on" : ""}
              onClick={() => router.replace(`${path}?tab=${t.key}`, { scroll: false })}
            >
              {t.name}
            </button>
          ))}
        </nav>
        {tab === "models" ? <ModelsTab /> : tab === "skill" ? <SkillTab /> : <UsageTab />}
      </div>
    </div>
  );
}
