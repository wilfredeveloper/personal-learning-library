/* Next-token probability bars: one row per candidate token, sorted high to low,
   with the sampled token marked. Reused by any lesson that shows a model's choice.
   API:  TokenBars.render(el, [{ tok: "you", p: 0.85 }, …], "you")
         TokenBars.sample([{ tok, p }, …])  -> a token drawn in proportion to p
   Styles: .tokbars in course.css. */
(function () {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  function render(el, entries, picked) {
    const rows = [...entries].sort((a, b) => b.p - a.p);
    const max = Math.max(...rows.map((r) => r.p), 1e-9);
    el.classList.add("tokbars");
    el.innerHTML = rows
      .map((r) => {
        const on = r.tok === picked ? " on" : "";
        const pct = (r.p * 100).toFixed(r.p < 0.1 ? 1 : 0);
        return `<div class="tb-row${on}"><span class="tb-tok">${esc(r.tok)}</span>` +
          `<span class="tb-bar"><i style="width:${(r.p / max) * 100}%"></i></span>` +
          `<span class="tb-p">${pct}%</span></div>`;
      })
      .join("");
  }

  function sample(entries) {
    const total = entries.reduce((s, e) => s + e.p, 0);
    let r = Math.random() * total;
    for (const e of entries) {
      r -= e.p;
      if (r < 0) return e.tok;
    }
    return entries[entries.length - 1].tok;
  }

  window.TokenBars = { render, sample };
})();
