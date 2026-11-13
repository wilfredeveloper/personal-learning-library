"use client";

// Teach skill tab (WP11): view and edit ~/.claude/skills/teach with a live diff against the
// saved file, an optional Claude review, and git underneath — every save is a commit, revert
// is `git revert`, and edits made outside the app show up as uncommitted changes to commit.
// Saving never waits on a review and nothing from a review is applied automatically.

import { useCallback, useEffect, useMemo, useState } from "react";
import { hunks, lineDiff, type Op } from "@/lib/skill-diff";
import "@/app/control/skill.css";

type Commit = { hash: string; short: string; date: string; subject: string; root: boolean };
type Info = { dir: string; repo: boolean; files: string[]; status: { lines: string[]; diff: string }; log: Commit[] };
type Review = { conflicts: string[]; vaguer: string[]; wouldStopDoing: string[]; summary: string };
type ReviewState = { file: string; text: string; loading: boolean; data?: Review; error?: string };
type Note = { ok: boolean; text: string };

async function api<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
  return data as T;
}

/** "SKILL.md: <first changed line>", markdown marks stripped, at most 72 characters. */
function suggestMessage(file: string, ops: Op[]) {
  const pick = ops.find((o) => o.t === "+" && o.line.trim()) ?? ops.find((o) => o.t === "-" && o.line.trim());
  if (!pick) return "";
  const text = pick.line.trim().replace(/^([#>*-]+|\d+\.)\s*/, "").replace(/[`*_]/g, "");
  const msg = `${file}: ${pick.t === "-" ? "remove " : ""}${text}`;
  return msg.length > 72 ? `${msg.slice(0, 71)}…` : msg;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

function DiffLines({ ops }: { ops: (Op | null)[] }) {
  return (
    <pre className="ctl-skill-diff">
      {ops.map((o, k) =>
        o ? (
          <div key={k} className={o.t === "+" ? "add" : o.t === "-" ? "del" : ""}>
            <span className="n">{o.t === "-" ? o.a : o.b}</span>
            {o.t} {o.line || " "}
          </div>
        ) : (
          <div key={k} className="gap">⋯</div>
        ),
      )}
    </pre>
  );
}

/** A `git show` / `git diff` patch, coloured by line. */
function Patch({ text }: { text: string }) {
  return (
    <pre className="ctl-skill-diff ctl-skill-patch">
      {text.split("\n").map((l, k) => (
        <div key={k} className={l.startsWith("+++") || l.startsWith("---") ? "meta" : l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : l.startsWith("@@") ? "hunk" : ""}>
          {l || " "}
        </div>
      ))}
    </pre>
  );
}

function ReviewBox({ r, stale }: { r: ReviewState; stale: boolean }) {
  if (r.loading) return <div className="ctl-skill-review"><p className="ctl-muted">Claude is reading the edit against the house rules…</p></div>;
  if (r.error) return <div className="ctl-skill-review err"><p>Review failed: {r.error}</p></div>;
  const d = r.data!;
  const sec = (title: string, items: string[]) => (
    <>
      <h4>{title}</h4>
      {items.length ? <ul>{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <p className="ctl-muted">None.</p>}
    </>
  );
  return (
    <div className="ctl-skill-review">
      <p className="ctl-skill-kicker">Review · advisory, nothing is applied</p>
      {stale && <p className="ctl-skill-stale">This review is of an earlier version of your edit.</p>}
      {d.summary && <p>{d.summary}</p>}
      {sec("Conflicts with house rules", d.conflicts)}
      {sec("Made vaguer", d.vaguer)}
      {sec("Claude would stop doing", d.wouldStopDoing)}
    </div>
  );
}

export default function SkillTab() {
  const [info, setInfo] = useState<Info | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [file, setFile] = useState("SKILL.md");
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const [review, setReview] = useState<ReviewState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  const [openCommit, setOpenCommit] = useState<string | null>(null);
  const [patches, setPatches] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<string | null>(null);
  const [outsideMsg, setOutsideMsg] = useState("Commit edits made outside the app");
  const [showOutside, setShowOutside] = useState(false);

  const loadInfo = useCallback(async () => {
    try {
      const i = await api<Info>("/api/skill");
      setInfo(i);
      setLoadErr(null);
      setFile((f) => (i.files.includes(f) ? f : i.files[0] ?? f));
    } catch (e) {
      setLoadErr((e as Error).message);
    }
  }, []);

  const loadFile = useCallback(async (name: string) => {
    try {
      const { text } = await api<{ text: string }>(`/api/skill?file=${encodeURIComponent(name)}`);
      setSaved((s) => ({ ...s, [name]: text }));
    } catch (e) {
      setNote({ ok: false, text: `Couldn't read ${name}: ${(e as Error).message}` });
    }
  }, []);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    if (info?.files.includes(file) && saved[file] === undefined) void loadFile(file);
  }, [info, file, saved, loadFile]);

  const original = saved[file];
  const draft = drafts[file] ?? original ?? "";
  const ops = useMemo(() => (original === undefined ? [] : lineDiff(original, draft)), [original, draft]);
  const changed = ops.some((o) => o.t !== " ");
  const shown = useMemo(() => hunks(ops, 2), [ops]);
  const added = ops.filter((o) => o.t === "+").length;
  const removed = ops.filter((o) => o.t === "-").length;
  const message = msgs[file] ?? suggestMessage(file, ops);

  const discard = () => {
    setDrafts((d) => { const n = { ...d }; delete n[file]; return n; });
    setMsgs((m) => { const n = { ...m }; delete n[file]; return n; });
    setReview(null);
  };

  const runReview = async () => {
    const text = draft;
    setReview({ file, text, loading: true });
    try {
      const data = await api<Review>("/api/skill/review", { file, old: original, new: text });
      setReview({ file, text, loading: false, data });
    } catch (e) {
      setReview({ file, text, loading: false, error: (e as Error).message });
    }
  };

  // After any commit: the history, the uncommitted list and the file texts may all have moved.
  // Clearing `saved` makes the effect above re-read the open file.
  const reloadAll = async () => {
    setSaved({});
    setPatches({});
    await loadInfo();
  };

  const act = async (body: Record<string, unknown>, done: (commit: string) => string, after?: () => void) => {
    setBusy(true);
    setNote(null);
    try {
      const { commit } = await api<{ commit: string }>("/api/skill", body);
      after?.();
      setNote({ ok: true, text: done(commit) });
      await reloadAll();
    } catch (e) {
      setNote({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const saveCommit = () =>
    act({ action: "save", file, base: original, text: draft, message }, (c) => `Saved ${file} as commit ${c}.`, () => {
      discard();
      setOpenCommit(null);
    });

  const toggleCommit = async (hash: string) => {
    setConfirm(null);
    if (openCommit === hash) return setOpenCommit(null);
    setOpenCommit(hash);
    if (patches[hash] === undefined) {
      try {
        const { diff } = await api<{ diff: string }>(`/api/skill?commit=${hash}`);
        setPatches((p) => ({ ...p, [hash]: diff }));
      } catch (e) {
        setPatches((p) => ({ ...p, [hash]: `Couldn't load this commit: ${(e as Error).message}` }));
      }
    }
  };

  if (loadErr) return <p className="ctl-muted">Couldn’t read the teach skill: {loadErr}</p>;
  if (!info) return <p className="ctl-muted">Reading the teach skill…</p>;

  const dirty = info.status.lines;
  const canSave = info.repo && !busy;

  return (
    <div className="ctl-skill">
      {!info.repo && (
        <div className="ctl-skill-banner warn">
          <b>{info.dir} isn’t a git repository</b>, so saving is off: every save here is a commit, and there is nowhere to put one. You can still edit and review.
        </div>
      )}
      {dirty.length > 0 && (
        <div className="ctl-skill-banner">
          <p>
            <b>{dirty.length} uncommitted change{dirty.length > 1 ? "s" : ""}</b> in the skill folder, made outside this app:{" "}
            {dirty.map((l) => <code key={l}>{l.slice(3)}</code>)}
            <button className="ctl-skill-link" onClick={() => setShowOutside((s) => !s)}>{showOutside ? "Hide diff" : "Show diff"}</button>
          </p>
          {showOutside && (info.status.diff ? <Patch text={info.status.diff} /> : <p className="ctl-muted">Only new files; no diff against the last commit.</p>)}
          <div className="ctl-skill-commitrow">
            <input value={outsideMsg} onChange={(e) => setOutsideMsg(e.target.value)} aria-label="Commit message for the outside changes" />
            <button className="primary" disabled={!canSave || !outsideMsg.trim()} onClick={() => act({ action: "commitAll", message: outsideMsg }, (c) => `Committed the outside changes as ${c}.`)}>
              Commit them
            </button>
          </div>
        </div>
      )}
      {note && <p className={`ctl-skill-note${note.ok ? "" : " err"}`} role="status">{note.text}</p>}

      <div className="ctl-skill-grid">
        <div className="ctl-skill-main">
          <div className="ctl-skill-files">
            {info.files.map((f) => (
              <button key={f} className={f === file ? "on" : ""} onClick={() => setFile(f)}>
                {f}
                {drafts[f] !== undefined && drafts[f] !== saved[f] ? " •" : ""}
              </button>
            ))}
          </div>
          <textarea
            className="ctl-skill-editor"
            value={draft}
            disabled={original === undefined}
            spellCheck={false}
            onChange={(e) => setDrafts((d) => ({ ...d, [file]: e.target.value }))}
            aria-label={`Edit ${file}`}
          />
        </div>

        <aside className="ctl-skill-side">
          <p className="ctl-skill-kicker">Changes to {file}</p>
          {!changed ? (
            <p className="ctl-muted">No changes. Edit the text and the diff against the saved file appears here.</p>
          ) : (
            <>
              <p className="ctl-skill-count"><span className="add">+{added}</span> <span className="del">−{removed}</span> lines</p>
              <DiffLines ops={shown} />
              <label className="ctl-skill-msg">
                <span>Commit message</span>
                <input value={message} onChange={(e) => setMsgs((m) => ({ ...m, [file]: e.target.value }))} />
              </label>
              <div className="ctl-skill-actions">
                <button onClick={runReview} disabled={review?.loading}>Review with Claude</button>
                <button onClick={discard} disabled={busy}>Discard</button>
                <button className="primary" onClick={saveCommit} disabled={!canSave || !message.trim()} title={info.repo ? undefined : "Saving is off: not a git repository"}>
                  Save as commit
                </button>
              </div>
              {review && review.file === file && <ReviewBox r={review} stale={review.text !== draft} />}
            </>
          )}

          <p className="ctl-skill-kicker ctl-skill-histhead">History · {info.dir}</p>
          {info.log.length === 0 ? (
            <p className="ctl-muted">No commits.</p>
          ) : (
            <ol className="ctl-skill-history">
              {info.log.map((c) => (
                <li key={c.hash} className={openCommit === c.hash ? "open" : ""}>
                  <button className="ctl-skill-commit" onClick={() => toggleCommit(c.hash)} aria-expanded={openCommit === c.hash}>
                    <code>{c.short}</code>
                    <span>{c.subject}</span>
                    <small>{when(c.date)}</small>
                  </button>
                  {!c.root &&
                    (confirm === c.hash ? (
                      <div className="ctl-skill-confirm">
                        <span>Make a new commit that undoes {c.short}?</span>
                        <button className="primary" disabled={busy} onClick={() => act({ action: "revert", hash: c.hash }, (n) => `Reverted ${c.short} as commit ${n}.`, () => setConfirm(null))}>
                          Yes, revert
                        </button>
                        <button onClick={() => setConfirm(null)}>Cancel</button>
                      </div>
                    ) : (
                      <button className="ctl-skill-revert" disabled={!canSave || dirty.length > 0} title={dirty.length ? "Commit the uncommitted changes first" : undefined} onClick={() => setConfirm(c.hash)}>
                        Revert
                      </button>
                    ))}
                  {openCommit === c.hash && (patches[c.hash] === undefined ? <p className="ctl-muted">Loading…</p> : <Patch text={patches[c.hash]} />)}
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  );
}
