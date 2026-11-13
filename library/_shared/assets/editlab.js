/* 2-D least-squares edit lab (model-editing course).
   One "layer" with 2 input columns and 1 output: the edit is a row vector Δ = [Δ1, Δ2],
   and any key x has its output moved by Δ·x. We want the target key k moved by r = 1
   while a cloud of protected keys c stays put:
       minimise (Δ·k − r)² + λ · mean_c (Δ·c)²   ⇒   Δ = r kᵀ (k kᵀ + λ C + εI)⁻¹,  C = mean c cᵀ
   Markup: <div class="editlab" data-goal-hit="0.9" data-goal-drift="0.09"
                data-angle="40" data-loglam="-1"></div>
   (all data-* optional; without the goal attributes no goal badge is shown).
   When framed (the study app), each time the goal becomes met it posts to the parent window
   { type: "lesson-event", kind: "lab", section, lab: "edit lab", goal: true, detail }. */
(function () {
  const CLOUD = [[14, 1.0], [18, 0.9], [21, 1.1], [25, 1.0], [29, 0.95], [17, 1.05]]
    .map(([a, l]) => [l * Math.cos(a * Math.PI / 180), l * Math.sin(a * Math.PI / 180)]);
  const C = [0, 0, 0];               // symmetric 2x2: [c11, c12, c22]
  CLOUD.forEach(([x, y]) => { C[0] += x * x; C[1] += x * y; C[2] += y * y; });
  C.forEach((_, i) => (C[i] /= CLOUD.length));
  const EPS = 1e-6, R = 1, S = 62;   // S = pixels per unit
  const f = (v, d = 2) => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(d);
  const NS = "http://www.w3.org/2000/svg";

  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }

  // Tell the study app the goal was just met. Only when framed; never breaks the lab.
  function post(root, detail) {
    try {
      if (window.parent === window) return;
      const h2s = [...document.querySelectorAll("h1, h2")] // the h1 names the part above the first h2
        .filter((h) => h.compareDocumentPosition(root) & Node.DOCUMENT_POSITION_FOLLOWING);
      const section = h2s.length ? h2s[h2s.length - 1].textContent.replace(/\s+/g, " ").trim() : "";
      window.parent.postMessage({ type: "lesson-event", kind: "lab", section, lab: "edit lab", goal: true, detail }, "*");
    } catch (e) { /* logging must never break the lab */ }
  }

  document.querySelectorAll(".editlab").forEach((root) => {
    const gh = parseFloat(root.dataset.goalHit), gd = parseFloat(root.dataset.goalDrift);
    const hasGoal = !isNaN(gh) && !isNaN(gd);
    root.innerHTML = `
      <div class="el-wrap">
        <svg class="el-plot" viewBox="-150 -150 300 300" role="img" aria-label="Key plane: protected keys, target key and the edit direction"></svg>
        <div class="el-side">
          <label>Target key angle <output data-o="ang"></output>
            <input type="range" min="0" max="180" step="1" data-i="ang"></label>
          <label>Protection λ <output data-o="lam"></output>
            <input type="range" min="-3" max="2" step="0.05" data-i="lam"></label>
          <dl class="el-read">
            <dt>Hit Δ·k</dt><dd data-o="hit"></dd>
            <dt>Drift</dt><dd data-o="drift"></dd>
            <dt>|Δ|</dt><dd data-o="norm"></dd>
          </dl>
          ${hasGoal ? `<p class="el-goal" data-o="goal"></p>` : ""}
        </div>
      </div>
      <p class="el-work" data-o="work"></p>
      <p class="el-legend"><span class="sw k"></span>target key k &nbsp; <span class="sw c"></span>protected keys c &nbsp;
        <span class="sw d"></span>edit Δ &nbsp; <span class="sw z"></span>keys Δ leaves untouched</p>`;
    const svg = root.querySelector("svg");
    const $ = (s) => root.querySelector(s);
    const ang = $('[data-i="ang"]'), lam = $('[data-i="lam"]');
    ang.value = root.dataset.angle || 40;
    lam.value = root.dataset.loglam || -1;

    // static layer: axes + protected cloud
    el("line", { x1: -145, y1: 0, x2: 145, y2: 0, class: "el-axis" }, svg);
    el("line", { x1: 0, y1: -145, x2: 0, y2: 145, class: "el-axis" }, svg);
    el("text", { x: 140, y: -6, class: "el-tick", "text-anchor": "end" }, svg).textContent = "col 1";
    el("text", { x: 6, y: -136, class: "el-tick" }, svg).textContent = "col 2";
    CLOUD.forEach(([x, y]) => {
      el("line", { x1: 0, y1: 0, x2: x * S, y2: -y * S, class: "el-c" }, svg);
      el("circle", { cx: x * S, cy: -y * S, r: 4, class: "el-cdot" }, svg);
    });
    const zero = el("line", { class: "el-zero" }, svg);
    const kLine = el("line", { x1: 0, y1: 0, class: "el-k" }, svg);
    const kDot = el("circle", { r: 5, class: "el-kdot" }, svg);
    const dLine = el("line", { x1: 0, y1: 0, class: "el-d" }, svg);
    const dHead = el("circle", { r: 4.5, class: "el-ddot" }, svg);
    const dLab = el("text", { class: "el-tick el-dl" }, svg);

    let wasOk = null;            // null until the first update: a goal already met on load is not posted
    function update() {
      const a = (+ang.value * Math.PI) / 180, l = Math.pow(10, +lam.value);
      const k = [Math.cos(a), Math.sin(a)];
      // A = k kᵀ + λ C + ε I  (2x2 symmetric)
      const A11 = k[0] * k[0] + l * C[0] + EPS, A12 = k[0] * k[1] + l * C[1], A22 = k[1] * k[1] + l * C[2] + EPS;
      const det = A11 * A22 - A12 * A12;
      // Δ = r kᵀ A⁻¹  (A symmetric, so Δᵀ = r A⁻¹ k)
      const d = [R * (A22 * k[0] - A12 * k[1]) / det, R * (-A12 * k[0] + A11 * k[1]) / det];
      const hit = d[0] * k[0] + d[1] * k[1];
      const drift = Math.sqrt(CLOUD.reduce((s, [x, y]) => s + (d[0] * x + d[1] * y) ** 2, 0) / CLOUD.length);
      const norm = Math.hypot(d[0], d[1]);

      kLine.setAttribute("x2", k[0] * S * 1.6); kLine.setAttribute("y2", -k[1] * S * 1.6);
      kDot.setAttribute("cx", k[0] * S * 1.6); kDot.setAttribute("cy", -k[1] * S * 1.6);
      const shown = Math.min(norm, 1.85) / (norm || 1);         // long Δ is drawn clipped at 1.85
      const dx = d[0] * shown * S, dy = -d[1] * shown * S;
      dLine.setAttribute("x2", dx); dLine.setAttribute("y2", dy);
      dHead.setAttribute("cx", dx); dHead.setAttribute("cy", dy);
      dLab.setAttribute("x", dx + (dx > 40 ? -7 : 7)); dLab.setAttribute("y", dy + (dy < -100 ? 16 : -6));
      dLab.setAttribute("text-anchor", dx > 40 ? "end" : "start");
      dLab.textContent = norm > 1.85 ? "Δ (drawn shorter)" : "Δ";
      if (norm > 1e-9) {           // keys x with Δ·x = 0 lie on the line perpendicular to Δ
        const px = -d[1] / norm, py = d[0] / norm;
        zero.setAttribute("x1", -px * 200); zero.setAttribute("y1", py * 200);
        zero.setAttribute("x2", px * 200); zero.setAttribute("y2", -py * 200);
      }

      $('[data-o="ang"]').textContent = `${ang.value}°`;
      $('[data-o="lam"]').textContent = l < 0.1 ? l.toFixed(3) : l < 10 ? l.toFixed(2) : l.toFixed(0);
      $('[data-o="hit"]').textContent = `${f(hit)}  (want 1.00)`;
      $('[data-o="drift"]').textContent = `${f(drift, 3)}  (want 0)`;
      $('[data-o="norm"]').textContent = f(norm);
      $('[data-o="work"]').innerHTML =
        `k = [${f(k[0])}, ${f(k[1])}] · A = kkᵀ + λC = [[${f(A11)}, ${f(A12)}], [${f(A12)}, ${f(A22)}]] · ` +
        `<b>Δ = r kᵀA⁻¹ = [${f(d[0])}, ${f(d[1])}]</b>`;
      if (hasGoal) {
        const ok = hit >= gh && drift <= gd;
        const g = $('[data-o="goal"]');
        g.className = "el-goal " + (ok ? "ok" : "no");
        g.textContent = ok ? `Goal met: hit ≥ ${gh}, drift ≤ ${gd}` : `Goal: hit ≥ ${gh} and drift ≤ ${gd}`;
        if (ok && wasOk === false) post(root, `goal met at ${ang.value}°, λ = ${$('[data-o="lam"]').textContent} (hit ${f(hit)}, drift ${f(drift, 3)})`);
        wasOk = ok;
      }
    }
    ang.addEventListener("input", update);
    lam.addEventListener("input", update);
    update();
  });
})();
