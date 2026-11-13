/* Interactive weight-matrix component. Laid out the way ML weight files store a "kernel":
   rows = inputs, columns = outputs, shape [in, out]. Each cell shows input × weight;
   each output is the sum down its column (a dot product).
   Markup:
     <div class="matmul" data-x="[1,0.5,-1]" data-w="[[0.8,-0.3],[0.2,0.9],[-0.5,0.4]]"
          data-in="R,G,B" data-out="warmth,brightness" data-range="2"></div>
*/
(function () {
  const fmt = (v) => (Math.abs(v) < 0.005 ? "0" : (v > 0 ? "" : "−") + Math.abs(v).toFixed(2).replace(/\.?0+$/, ""));

  function tint(v, scale) {
    const a = Math.min(Math.abs(v) / scale, 1);
    const pct = Math.round(a * 85);
    return v >= 0
      ? `color-mix(in srgb, var(--warm) ${pct}%, var(--panel))`
      : `color-mix(in srgb, var(--accent) ${pct}%, var(--panel))`;
  }

  function build(root, idx) {
    const x = JSON.parse(root.dataset.x);
    const W = JSON.parse(root.dataset.w);
    const inL = (root.dataset.in || "").split(",").map((s) => s.trim());
    const outL = (root.dataset.out || "").split(",").map((s) => s.trim());
    const range = parseFloat(root.dataset.range || "2");
    const nIn = W.length, nOut = W[0].length;

    root.innerHTML = "";
    const badge = document.createElement("div");
    badge.className = "mm-badge";
    badge.innerHTML = `weight shape <code>[${nIn}, ${nOut}]</code> · ${nIn} numbers in → ${nOut} out`;
    root.appendChild(badge);

    const wrap = document.createElement("div");
    wrap.className = "scroll-x";
    const grid = document.createElement("div");
    grid.className = "mm-grid";
    grid.style.gridTemplateColumns = `minmax(9.5rem, auto) repeat(${nOut}, minmax(5.2rem, 1fr))`;
    wrap.appendChild(grid);
    root.appendChild(wrap);

    const cell = (cls, html) => { const d = document.createElement("div"); d.className = cls; d.innerHTML = html || ""; grid.appendChild(d); return d; };

    cell("mm-corner", "<span>input</span><span>output →</span>");
    const heads = outL.map((l, j) => cell("mm-head", l || `out ${j + 1}`));

    const sliders = [], cells = [];
    for (let i = 0; i < nIn; i++) {
      const row = cell("mm-in");
      const id = `mm${idx}-x${i}`;
      row.innerHTML = `<label for="${id}">${inL[i] || "in " + (i + 1)}</label>
        <input id="${id}" type="range" min="${-range}" max="${range}" step="0.1" value="${x[i]}">
        <output class="mono"></output>`;
      sliders.push(row);
      cells.push(W[i].map((w) => cell("mm-cell", `<span class="mm-w">× ${fmt(w)}</span><span class="mm-p"></span>`)));
    }
    cell("mm-sum-label", "<span>sum each column</span>");
    const sums = outL.length ? outL.map(() => cell("mm-sum")) : W[0].map(() => cell("mm-sum"));

    function update() {
      const xs = sliders.map((r) => parseFloat(r.querySelector("input").value));
      sliders.forEach((r, i) => (r.querySelector("output").textContent = fmt(xs[i])));
      const scale = range * Math.max(...W.flat().map(Math.abs));
      for (let j = 0; j < nOut; j++) {
        let s = 0;
        for (let i = 0; i < nIn; i++) {
          const p = xs[i] * W[i][j];
          s += p;
          const c = cells[i][j];
          c.querySelector(".mm-p").textContent = fmt(p);
          c.style.background = tint(p, scale);
        }
        sums[j].innerHTML = `<span class="mm-total">${fmt(s)}</span><span class="mm-bar"><i style="width:${Math.min(Math.abs(s) / (scale * 1.2), 1) * 100}%;background:${s >= 0 ? "var(--warm)" : "var(--accent)"}"></i></span>`;
      }
    }

    function highlight(j) {
      grid.classList.toggle("mm-focus", j !== null);
      heads.forEach((h, k) => h.classList.toggle("on", k === j));
      sums.forEach((h, k) => h.classList.toggle("on", k === j));
      cells.forEach((row) => row.forEach((c, k) => c.classList.toggle("on", k === j)));
    }
    [heads, sums].forEach((list) => list.forEach((el, j) => {
      el.addEventListener("mouseenter", () => highlight(j));
      el.addEventListener("mouseleave", () => highlight(null));
    }));
    cells.forEach((row) => row.forEach((c, j) => {
      c.addEventListener("mouseenter", () => highlight(j));
      c.addEventListener("mouseleave", () => highlight(null));
    }));

    sliders.forEach((r) => r.querySelector("input").addEventListener("input", update));
    update();
  }

  document.querySelectorAll(".matmul").forEach(build);
})();
