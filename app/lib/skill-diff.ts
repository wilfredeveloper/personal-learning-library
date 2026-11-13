// Line diff for the Teach skill tab (WP11). Pure, so the tab (live diff) and the
// review route (unified diff sent to Claude) share it.

export type Op = { t: " " | "+" | "-"; line: string; a: number; b: number }; // a, b: 1-based line numbers in old/new

export function lineDiff(oldText: string, newText: string): Op[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  // Strip the common head and tail so the LCS table only covers the edited middle.
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const am = a.slice(s, a.length - e);
  const bm = b.slice(s, b.length - e);
  const n = am.length, m = bm.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = am[i] === bm[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);

  const out: Op[] = [];
  for (let k = 0; k < s; k++) out.push({ t: " ", line: a[k], a: k + 1, b: k + 1 });
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && am[i] === bm[j]) { out.push({ t: " ", line: am[i], a: s + i + 1, b: s + j + 1 }); i++; j++; }
    else if (j >= m || (i < n && L[i + 1][j] >= L[i][j + 1])) { out.push({ t: "-", line: am[i], a: s + i + 1, b: s + j }); i++; }
    else { out.push({ t: "+", line: bm[j], a: s + i, b: s + j + 1 }); j++; }
  }
  for (let k = 0; k < e; k++) out.push({ t: " ", line: a[a.length - e + k], a: a.length - e + k + 1, b: b.length - e + k + 1 });
  return out;
}

/** Changed lines with `ctx` lines of context around them; null marks a gap between groups. */
export function hunks(ops: Op[], ctx: number): (Op | null)[] {
  const keep = ops.map((_, i) => ops.slice(Math.max(0, i - ctx), i + ctx + 1).some((o) => o.t !== " "));
  const out: (Op | null)[] = [];
  ops.forEach((o, i) => {
    if (!keep[i]) return;
    if (out.length && !keep[i - 1]) out.push(null);
    out.push(o);
  });
  return out;
}

/** A unified diff (3 lines of context), as `git diff` would print it. */
export function unifiedDiff(name: string, oldText: string, newText: string): string {
  const groups: Op[][] = [[]];
  for (const o of hunks(lineDiff(oldText, newText), 3)) {
    if (o) groups[groups.length - 1].push(o);
    else groups.push([]);
  }
  const body = groups
    .filter((g) => g.length)
    .map((g) => {
      const olds = g.filter((o) => o.t !== "+");
      const news = g.filter((o) => o.t !== "-");
      const aStart = olds.length ? olds[0].a : g[0].a;
      const bStart = news.length ? news[0].b : g[0].b;
      return [`@@ -${aStart},${olds.length} +${bStart},${news.length} @@`, ...g.map((o) => o.t + o.line)].join("\n");
    });
  return body.length ? [`--- a/${name}`, `+++ b/${name}`, ...body].join("\n") : "";
}
