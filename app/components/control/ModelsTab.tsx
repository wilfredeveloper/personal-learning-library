"use client";

// Models tab: which Claude model answers each feature (models.json via /api/settings), with the
// measured speed and cost from calls.jsonl, and the "Prefetch pictures" switch. Nothing is
// estimated: a model with no calls for a feature shows "not measured".

import { Fragment, useEffect, useState } from "react";
import "@/app/control/models.css";

type Model = "haiku" | "sonnet" | "opus";
const MODELS: Model[] = ["haiku", "sonnet", "opus"];
const NAME: Record<Model, string> = { haiku: "Haiku", sonnet: "Sonnet", opus: "Opus" };
const FEATURES: { key: string; what: string }[] = [
  { key: "explain.1", what: "Canvas card · definition" },
  { key: "explain.2", what: "Canvas card · plain words" },
  { key: "explain.3", what: "Canvas card · how it works" },
  { key: "explain.4", what: "Canvas card · picture (SVG)" },
  { key: "ask.simple", what: "Reader tutor · simple" },
  { key: "ask.mid", what: "Reader tutor · mid" },
  { key: "ask.deep", what: "Reader tutor · deep" },
  { key: "warmup", what: "Warm-up questions from your gaps" },
  { key: "recall", what: "“Recall first?” question on a reused card" },
];

type Stat = { n: number; first: number; total: number; cost: number };
type Settings = { models: Record<string, Model>; prefetchPictures: boolean };
type Data = Settings & {
  measured: { days: number; stats: Record<string, Partial<Record<Model, Stat>>>; pictures: { calls: number; cost: number } };
};

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
const usd = (x: number) => `$${x.toFixed(x < 0.01 ? 4 : x < 1 ? 3 : 2)}`;

export default function ModelsTab() {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState("");
  const [pick, setPick] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/settings?measured=1")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d: Data) => {
        setData(d);
        setPick({ models: d.models, prefetchPictures: d.prefetchPictures });
      })
      .catch((e: Error) => setFailed(e.message));
  }, []);

  if (failed) return <p className="ctl-muted">Couldn’t load the model settings ({failed}).</p>;
  if (!data || !pick) return <p className="ctl-muted">Loading…</p>;

  const { stats, days, pictures } = data.measured;
  const changed = FEATURES.filter((f) => pick.models[f.key] !== data.models[f.key]);
  const prefetchChanged = pick.prefetchPictures !== data.prefetchPictures;
  const changes = [
    ...changed.map((f) => `${f.key} → ${NAME[pick.models[f.key]]}`),
    ...(prefetchChanged ? [`prefetch pictures ${pick.prefetchPictures ? "on" : "off"}`] : []),
  ];

  const apply = async () => {
    setSaving(true);
    try {
      const body: Partial<Settings> = { models: Object.fromEntries(changed.map((f) => [f.key, pick.models[f.key]])) };
      if (prefetchChanged) body.prefetchPictures = pick.prefetchPictures;
      const r = await fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${r.status}`);
      const saved = (await r.json()) as Settings;
      setData({ ...data, ...saved });
      setPick(saved);
    } catch (e) {
      alert(`Couldn’t save: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ctl-models">
      <p className="ctl-models-lede">
        Which model answers each feature. A change applies to the next call, no restart. Numbers are your measured
        medians over the last {days} days (list-price cost per call; on a subscription it isn’t billed per call).
      </p>
      <table className="ctl-models-table">
        <thead>
          <tr><th>Feature</th><th>Model</th><th>First words</th><th>Finished</th><th>Per call</th></tr>
        </thead>
        <tbody>
          {FEATURES.map((f) => {
            const m = pick.models[f.key];
            const s = stats[f.key]?.[m];
            const others = MODELS.filter((o) => o !== m);
            return (
              <Fragment key={f.key}>
                <tr className={`main${m !== data.models[f.key] ? " changed" : ""}`}>
                  <td className="feat"><code>{f.key}</code><small>{f.what}</small></td>
                  <td className="pick">
                    <select
                      value={m}
                      onChange={(e) => setPick({ ...pick, models: { ...pick.models, [f.key]: e.target.value as Model } })}
                      aria-label={`Model for ${f.key}`}
                    >
                      {MODELS.map((o) => <option key={o} value={o}>{NAME[o]}</option>)}
                    </select>
                  </td>
                  {s ? (
                    <>
                      <td data-label="First words">{sec(s.first)}</td>
                      <td data-label="Finished">{sec(s.total)}</td>
                      <td data-label="Per call">{usd(s.cost)} <small>{s.n} call{s.n > 1 ? "s" : ""}</small></td>
                    </>
                  ) : (
                    <td className="none" colSpan={3}>no data yet for {NAME[m]}</td>
                  )}
                </tr>
                <tr className={`cmp${m !== data.models[f.key] ? " changed" : ""}`}>
                  <td colSpan={5}>
                    {others.map((o) => {
                      const x = stats[f.key]?.[o];
                      return (
                        <span key={o}>
                          <b>{NAME[o]}</b>{" "}
                          {x ? `${sec(x.first)} · ${sec(x.total)} · ${usd(x.cost)} · ${x.n} call${x.n > 1 ? "s" : ""}` : "not measured"}
                        </span>
                      );
                    })}
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>

      <section className="ctl-models-prefetch">
        <button
          role="switch"
          aria-checked={pick.prefetchPictures}
          className={pick.prefetchPictures ? "on" : ""}
          onClick={() => setPick({ ...pick, prefetchPictures: !pick.prefetchPictures })}
        >
          <span aria-hidden="true" />
        </button>
        <div>
          <h3>Prefetch pictures</h3>
          <p>When on, a canvas card at “how it works” already draws its picture, so zooming in shows it at once; when off, the picture is drawn only when you zoom to it.</p>
          <p className="ctl-muted">
            Picture calls (<code>explain.4</code>) in the last {days} days: <b>{pictures.calls}</b>, {usd(pictures.cost)} at list price.
            That counts every picture, prefetched or zoomed to; the log can’t tell which prefetched pictures you later opened.
          </p>
        </div>
      </section>

      <div className="ctl-models-savebar">
        {changes.length ? (
          <>
            <span>{changes.length} change{changes.length > 1 ? "s" : ""}: {changes.join(", ")}</span>
            <button onClick={() => setPick({ models: data.models, prefetchPictures: data.prefetchPictures })} disabled={saving}>Undo</button>
            <button className="primary" onClick={apply} disabled={saving}>{saving ? "Saving…" : "Apply"}</button>
          </>
        ) : (
          <span className="ctl-muted">No pending changes.</span>
        )}
      </div>
    </div>
  );
}
