"use client";

// Usage tab of the control room: what the Claude calls in calls.jsonl cost and how fast they were,
// by day, feature and course, plus the slowest and failed ones. Reads GET /api/calls.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Call } from "@/lib/calls";
import { FEATURE_WHAT, secs, sinceDay, summarize, usd } from "@/lib/usage";
import "@/app/control/usage.css";

const RANGES = [7, 30, 90];

// Smallest 1/2/2.5/5 × 10^k at or above x, so the axis ends on a round number.
function niceTop(x: number) {
  if (x <= 0) return 0.01;
  const p = 10 ** Math.floor(Math.log10(x));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((v) => v >= x)!;
}
const dayLabel = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (t: string) =>
  new Date(t).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function UsageTab() {
  const [range, setRange] = useState(30);
  const [data, setData] = useState<{ range: number; calls: Call[] } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/calls?since=${sinceDay(range)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((j: { calls: Call[] }) => live && (setData({ range, calls: j.calls }), setFailed(false)))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [range]);

  const s = useMemo(() => (data ? summarize(data.calls, data.range) : null), [data]);

  const picker = (
    <div className="ctl-usage-range" role="group" aria-label="Range">
      {RANGES.map((n) => (
        <button key={n} aria-pressed={range === n} className={range === n ? "on" : ""} onClick={() => setRange(n)}>
          {n} days
        </button>
      ))}
    </div>
  );

  if (failed) return <>{picker}<p className="ctl-muted">Couldn’t read the call log.</p></>;
  if (!s) return <>{picker}<p className="ctl-muted">Loading…</p></>;
  if (!s.calls)
    return (
      <>
        {picker}
        <div className="ctl-usage-empty">
          <b>No Claude calls in the last {data!.range} days.</b>
          <p className="ctl-muted">Each canvas card, tutor question and warm-up adds a line here once it runs.</p>
        </div>
      </>
    );

  return (
    <>
      {picker}
      <div className="ctl-usage-kpis">
        <div><small>Claude calls · {data!.range} days</small><b>{s.calls}</b></div>
        <div><small>List-price equivalent</small><b>{usd(s.cost)}</b><em>on your subscription this isn’t billed per call</em></div>
        <div><small>Median time to first words</small><b>{secs(s.first)}</b></div>
        <div><small>Failed calls</small><b>{s.failed}</b><em>{((s.failed / s.calls) * 100).toFixed(1)}% of calls</em></div>
      </div>

      <h3 className="ctl-usage-h">List-price equivalent per day</h3>
      <Chart days={s.days} />

      <h3 className="ctl-usage-h">By feature</h3>
      <div className="ctl-usage-scroll">
        <table className="ctl-usage-table">
          <thead>
            <tr><th>Feature</th><th>Model</th><th>Calls</th><th>First words</th><th>Finished</th><th>Cost</th><th>Failed</th></tr>
          </thead>
          <tbody>
            {s.features.map((f) => (
              <tr key={f.key}>
                <td><code>{f.key}</code>{FEATURE_WHAT[f.key] && <small>{FEATURE_WHAT[f.key]}</small>}</td>
                <td>{f.models.map((m) => <span key={m} className="ctl-usage-model">{m}</span>)}</td>
                <td>{f.calls}</td>
                <td>{secs(f.first)}</td>
                <td>{secs(f.total)}</td>
                <td>{usd(f.cost)}</td>
                <td>{f.failed || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ctl-usage-h">By course</h3>
      <div className="ctl-usage-scroll">
        <table className="ctl-usage-table ctl-usage-narrow">
          <thead>
            <tr><th>Course</th><th>Calls</th><th>Cost</th><th>Failed</th></tr>
          </thead>
          <tbody>
            {s.courses.map((c) => (
              <tr key={c.key}>
                <td>{c.key}</td>
                <td>{c.calls}</td>
                <td>{usd(c.cost)}</td>
                <td>{c.failed || ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3 className="ctl-usage-h">Slowest 5</h3>
      <CallList calls={s.slowest} />

      <h3 className="ctl-usage-h">Failed calls{s.failures.length > 20 ? " · latest 20" : ""}</h3>
      {s.failures.length ? <CallList calls={s.failures.slice(0, 20)} /> : <p className="ctl-muted">None in this range.</p>}
    </>
  );
}

function CallList({ calls }: { calls: Call[] }) {
  return (
    <div className="ctl-usage-scroll">
      <table className="ctl-usage-table">
        <thead>
          <tr><th>When</th><th>Feature</th><th>Model</th><th>Duration</th><th>Error</th></tr>
        </thead>
        <tbody>
          {calls.map((c, i) => (
            <tr key={`${c.t}-${i}`}>
              <td className="ctl-usage-nowrap">{when(c.t)}</td>
              <td><code>{c.feature}</code></td>
              <td><span className="ctl-usage-model">{c.model || "(unknown)"}</span></td>
              <td>{secs(c.ms_total)}</td>
              <td className="ctl-usage-err">{c.error ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Chart({ days }: { days: { day: string; calls: number; cost: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Drawn at the box's real width, so ticks stay 11 px on a phone and on a wide screen.
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(760);
  useEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setW(Math.max(280, Math.round(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const top = niceTop(Math.max(...days.map((d) => d.cost)));
  const H = W < 500 ? 140 : 180, padL = 52, padB = 26, band = (W - padL) / days.length, bw = Math.min(24, band * 0.6);
  const r = Math.min(4, bw / 2);
  const every = Math.ceil(days.length / Math.max(2, Math.floor((W - padL) / 64))); // a date label every ~64 px
  const tick = (v: number) => (top < 0.1 ? `$${v.toFixed(3)}` : `$${v.toFixed(2)}`);
  const h = hover === null ? null : days[hover];
  const at = hover === null ? 0 : (padL + hover * band + band / 2) / W;
  return (
    <div ref={box} className="ctl-usage-chart" onPointerLeave={() => setHover(null)}>
      <svg viewBox={`0 0 ${W} ${H + padB}`} role="img" aria-label={`List-price cost per day, last ${days.length} days`}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W} y1={H - f * H * 0.92} y2={H - f * H * 0.92} className="ctl-usage-grid" />
            <text x={padL - 8} y={H - f * H * 0.92 + 4} textAnchor="end" className="ctl-usage-tick">{tick(top * f)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const bh = (d.cost / top) * H * 0.92;
          const x = padL + i * band + (band - bw) / 2;
          const rr = Math.min(r, bh);
          return (
            <g key={d.day} onPointerEnter={() => setHover(i)}>
              <rect x={padL + i * band} y={0} width={band} height={H} fill="transparent" />
              {bh > 0 && (
                <path
                  d={`M${x} ${H} V${H - bh + rr} q0 ${-rr} ${rr} ${-rr} h${bw - 2 * rr} q${rr} 0 ${rr} ${rr} V${H} Z`}
                  className={`ctl-usage-bar${hover === i ? " on" : ""}`}
                />
              )}
              {(days.length - 1 - i) % every === 0 && (
                <text
                  x={i === days.length - 1 ? W : padL + i * band + band / 2}
                  y={H + 18}
                  textAnchor={i === days.length - 1 ? "end" : "middle"}
                  className="ctl-usage-tick"
                >{dayLabel(d.day)}</text>
              )}
            </g>
          );
        })}
      </svg>
      {h && (
        <div className="ctl-usage-tip" style={{ left: `${at * 100}%`, transform: `translateX(${-at * 100}%)` }}>
          <b>{usd(h.cost)}</b> {dayLabel(h.day)} · {h.calls} call{h.calls === 1 ? "" : "s"}
        </div>
      )}
    </div>
  );
}
