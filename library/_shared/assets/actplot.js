/* Activation-function explorer. Plots elementwise functions f(z) and lets the reader slide z.
   Markup:
     <div class="actplot" data-fns="relu,sigmoid,silu,gelu" data-z="-1" data-range="5"></div>
   data-fns: any of relu, sigmoid, silu, gelu, linear (drawn in that order).
   data-z: starting slider value. data-range: plot spans z in [-range, range].
*/
(function () {
  const sig = (z) => 1 / (1 + Math.exp(-z));
  const FNS = {
    linear:  { label: "linear  z",       f: (z) => z,                color: "var(--muted)", dash: "4 4" },
    relu:    { label: "ReLU",            f: (z) => Math.max(0, z),   color: "var(--muted)" },
    sigmoid: { label: "sigmoid σ(z)",    f: sig,                     color: "var(--good)" },
    silu:    { label: "SiLU z·σ(z)",     f: (z) => z * sig(z),       color: "var(--warm)" },
    gelu:    { label: "GELU (tanh form)", f: (z) => 0.5 * z * (1 + Math.tanh(Math.sqrt(2 / Math.PI) * (z + 0.044715 * z ** 3))), color: "var(--accent)" },
  };
  const NS = "http://www.w3.org/2000/svg";
  const el = (tag, attrs, parent) => {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  };
  const fmt = (v) => (v < -0.0005 ? "−" : "") + Math.abs(v).toFixed(3);

  function build(root, idx) {
    const names = (root.dataset.fns || "relu,sigmoid,silu,gelu").split(",").map((s) => s.trim()).filter((s) => FNS[s]);
    const R = parseFloat(root.dataset.range || "5");
    const z0 = parseFloat(root.dataset.z || "0");
    const W = 360, H = 260, pad = 26;
    const yMin = -1.5, yMax = R;
    const sx = (z) => pad + ((z + R) / (2 * R)) * (W - 2 * pad);
    const sy = (y) => H - pad - ((y - yMin) / (yMax - yMin)) * (H - 2 * pad);

    root.innerHTML = "";
    const wrap = document.createElement("div");
    wrap.className = "ap-wrap";
    root.appendChild(wrap);

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, class: "ap-plot", role: "img", "aria-label": "Activation function curves" }, wrap);
    el("line", { x1: pad, x2: W - pad, y1: sy(0), y2: sy(0), class: "ap-axis" }, svg);
    el("line", { x1: sx(0), x2: sx(0), y1: pad / 2, y2: H - pad, class: "ap-axis" }, svg);
    for (let t = -R; t <= R; t++) {
      if (t === 0) continue;
      el("text", { x: sx(t), y: sy(0) + 13, class: "ap-tick", "text-anchor": "middle" }, svg).textContent = t;
    }
    for (const t of [1, 2, 3, 4].filter((v) => v < yMax)) {
      el("text", { x: sx(0) - 5, y: sy(t) + 3, class: "ap-tick", "text-anchor": "end" }, svg).textContent = t;
    }
    el("text", { x: sx(0) - 5, y: sy(-1) + 3, class: "ap-tick", "text-anchor": "end" }, svg).textContent = "−1";

    const dots = {};
    names.forEach((n) => {
      const F = FNS[n];
      let d = "";
      for (let i = 0; i <= 240; i++) {
        const z = -R + (2 * R * i) / 240;
        const y = Math.max(yMin, Math.min(yMax, F.f(z)));
        d += (i ? "L" : "M") + sx(z).toFixed(1) + " " + sy(y).toFixed(1);
      }
      const p = el("path", { d, fill: "none", "stroke-width": n === "linear" ? 1.2 : 2.2 }, svg);
      p.style.stroke = F.color; /* CSS variables only resolve through style, not SVG attributes */
      if (F.dash) p.setAttribute("stroke-dasharray", F.dash);
      dots[n] = el("circle", { r: 4.2 }, svg);
      dots[n].style.fill = F.color;
    });
    const cursor = el("line", { y1: pad / 2, y2: H - pad, class: "ap-cursor" }, svg);

    const side = document.createElement("div");
    side.className = "ap-side";
    const id = `ap${idx}`;
    side.innerHTML = `<label for="${id}">input z <output class="mono"></output></label>
      <input id="${id}" type="range" min="${-R}" max="${R}" step="0.1" value="${z0}">
      <dl class="ap-read"></dl>`;
    wrap.appendChild(side);
    const input = side.querySelector("input"), out = side.querySelector("output"), read = side.querySelector(".ap-read");
    read.innerHTML = names.map((n) => `<dt><span class="sw" style="background:${FNS[n].color}"></span>${FNS[n].label}</dt><dd data-n="${n}"></dd>`).join("");

    function update() {
      const z = parseFloat(input.value);
      out.textContent = fmt(z).replace(/0+$/, "").replace(/\.$/, "");
      cursor.setAttribute("x1", sx(z));
      cursor.setAttribute("x2", sx(z));
      names.forEach((n) => {
        const y = FNS[n].f(z);
        dots[n].setAttribute("cx", sx(z));
        dots[n].setAttribute("cy", sy(Math.max(yMin, Math.min(yMax, y))));
        read.querySelector(`dd[data-n="${n}"]`).textContent = fmt(y);
      });
    }
    input.addEventListener("input", update);
    update();
  }

  document.querySelectorAll(".actplot").forEach(build);
})();
