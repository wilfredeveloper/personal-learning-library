/* "Two brains, one pipe": a simulator of the how-llms-work Simple Chat route.
   Left: the server's brain. Middle: the raw text/event-stream bytes on the wire.
   Right: what the browser renders. Two brains share the same pipe:
     - ELIZA: a JS port of getSimpleChatResponse (src/routes/simple-chat.ts) — the whole
       reply exists before the first byte is sent; streaming only paces it out.
     - Toy LM: a hand-written next-token table that looks one token back — each token
       is sampled only after the previous one exists (the autoregressive loop).
   Markup: <div class="streamlab" data-message="I feel tired today"></div>
   Needs tokenbars.js loaded first. Styles: .streamlab in course.css. */
(function () {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

  // ---- ELIZA: faithful port of getSimpleChatResponse ----
  const GREETINGS = ["hello", "hi", "hey", "morning", "afternoon", "evening"];
  const CONTINUATIONS = ["Please go on.", "Can you tell me more about that?", "Tell me more.", "How does that make you feel?"];
  function eliza(message) {
    const lower = message.toLowerCase();
    const words = lower.split(" ").map((w) => w.replace(/[!?.;,:"']/g, "")).filter((w) => w.trim() !== "");
    if (GREETINGS.some((g) => words.includes(g))) return { rule: "greeting word", reply: "Hello! How can I help you today?" };
    if (lower.startsWith("i feel")) {
      const feeling = lower.slice("i feel".length + 1).replace(" i ", " you ");
      return { rule: "starts with “i feel”", reply: `Why do you feel ${feeling}?` };
    }
    const subj = words.indexOf("my") + 1;
    if (subj > 0 && subj < words.length) return { rule: "contains “my X”", reply: `Tell me more about your ${words[subj]}.` };
    if (lower.includes("worried")) return { rule: "contains “worried”", reply: "How long have you been worried about this?" };
    return { rule: "no match → random fallback", reply: CONTINUATIONS[Math.floor(Math.random() * CONTINUATIONS.length)] };
  }

  // ---- Toy LM: p(next | previous token). Hand-written, NOT trained. ----
  const T = {
    "<s>": { Why: 0.45, Tell: 0.3, How: 0.15, Please: 0.1 },
    Why: { do: 0.7, does: 0.2, not: 0.1 },
    do: { you: 0.85, they: 0.15 },
    does: { that: 0.8, it: 0.2 },
    you: { feel: 0.55, think: 0.3, say: 0.15 },
    they: { feel: 0.5, think: 0.5 },
    that: { matter: 0.55, "?": 0.3, worry: 0.15 },
    it: { matter: 0.5, ".": 0.3, feel: 0.2 },
    feel: { "?": 0.35, that: 0.4, tired: 0.25 },
    think: { so: 0.5, that: 0.3, "?": 0.2 },
    so: { "?": 1 },
    say: { "?": 0.6, that: 0.4 },
    Tell: { me: 1 },
    me: { more: 0.75, about: 0.25 },
    more: { ".": 0.6, about: 0.4 },
    about: { that: 0.4, it: 0.3, your: 0.3 },
    your: { day: 0.5, week: 0.5 },
    day: { ".": 0.6, "?": 0.4 },
    week: { ".": 0.6, "?": 0.4 },
    How: { does: 0.5, long: 0.5 },
    long: { have: 0.6, "?": 0.4 },
    have: { you: 1 },
    Please: { go: 1 },
    go: { on: 1 },
    on: { ".": 1 },
    not: { "?": 1 },
    tired: { "?": 0.6, ".": 0.4 },
    matter: { "?": 0.6, ".": 0.4 },
    worry: { "?": 0.6, you: 0.4 },
  };
  const END = new Set(["?", "."]);
  const join = (toks) => toks.reduce((s, t) => (END.has(t) || !s ? s + t : s + " " + t), "");

  function build(root) {
    root.innerHTML = `
      <div class="sl-controls">
        <label class="sl-msg"><span>You type</span><input type="text" value="${esc(root.dataset.message || "I feel tired today")}" spellcheck="false"></label>
        <div class="sl-brain" role="group" aria-label="Which brain">
          <button type="button" data-b="eliza" aria-pressed="true">ELIZA rules</button>
          <button type="button" data-b="lm" aria-pressed="false">Toy language model</button>
        </div>
        <button type="button" class="sl-send">Send ▸</button>
      </div>
      <div class="sl-panes">
        <section class="sl-pane"><h4>Server · the brain</h4><div class="sl-server"><p class="sl-idle">Press Send.</p></div></section>
        <section class="sl-pane"><h4>Wire · text/event-stream</h4><pre class="sl-wire" aria-label="Raw stream"></pre></section>
        <section class="sl-pane"><h4>Browser · what you see</h4><div class="sl-bubble" aria-live="polite"></div><p class="sl-clock"></p></section>
      </div>`;
    const $ = (s) => root.querySelector(s);
    const input = $("input"), send = $(".sl-send"), server = $(".sl-server"), wire = $(".sl-wire"), bubble = $(".sl-bubble"), clock = $(".sl-clock");
    let brain = "eliza", run = 0;

    root.querySelectorAll(".sl-brain button").forEach((b) =>
      b.addEventListener("click", () => {
        brain = b.dataset.b;
        root.querySelectorAll(".sl-brain button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      }));

    async function go() {
      const id = ++run;
      const alive = () => id === run;
      let t = 0;
      wire.textContent = ""; bubble.textContent = ""; clock.textContent = "";
      const shown = [];
      const emit = async (data, event, delay) => {
        wire.textContent += `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        wire.scrollTop = wire.scrollHeight;
        if (data.word || data.token) { shown.push(data.word || data.token); bubble.textContent = brain === "eliza" ? shown.join(" ") : join(shown); }
        clock.textContent = `t = ${(t / 1000).toFixed(1)} s`;
        if (delay) { await sleep(delay); t += delay; }
      };

      if (brain === "eliza") {
        const { rule, reply } = eliza(input.value.trim() || " ");
        const words = reply.split(" ");
        const paint = (k) => {
          server.innerHTML = `<p class="sl-note">Rule matched: <b>${esc(rule)}</b>. The <em>whole</em> reply exists now, before byte one is sent:</p>` +
            `<p class="sl-words">${words.map((w, i) => `<span class="${i < k ? "sent" : i === k ? "now" : "queued"}">${esc(w)}</span>`).join(" ")}</p>` +
            `<p class="sl-note">Streaming just paces it: <code>emit(…, 200)</code> sleeps 200 ms between words.</p>`;
        };
        paint(-1);
        await emit({}, "start", 1000); if (!alive()) return;
        for (let i = 0; i < words.length; i++) { paint(i); await emit({ word: words[i] }, "word", 200); if (!alive()) return; }
        paint(words.length);
        await emit({}, "done");
      } else {
        const toks = []; const probs = [];
        let prev = "<s>";
        server.innerHTML = `<p class="sl-note">Context so far: <b class="sl-ctx">(empty)</b></p><div class="sl-bars"></div><p class="sl-chain"></p>`;
        const ctx = server.querySelector(".sl-ctx"), bars = server.querySelector(".sl-bars"), chain = server.querySelector(".sl-chain");
        await emit({}, "start", 600); if (!alive()) return;
        for (let step = 0; step < 12; step++) {
          const dist = Object.entries(T[prev] || { ".": 1 }).map(([tok, p]) => ({ tok, p }));
          window.TokenBars.render(bars, dist, null);
          await sleep(450); if (!alive()) return;
          const pick = window.TokenBars.sample(dist);
          window.TokenBars.render(bars, dist, pick);
          toks.push(pick); probs.push(T[prev][pick] ?? 1);
          ctx.textContent = join(toks);
          const P = probs.reduce((a, b) => a * b, 1);
          chain.innerHTML = `P(reply) = ${probs.map((p) => p.toFixed(2)).join(" × ")} = <b>${P.toPrecision(2)}</b>` +
            ` <span>· log P = ${Math.log(P).toFixed(2)}</span>`;
          await emit({ token: pick }, "token", 500); if (!alive()) return;
          if (END.has(pick)) break;
          prev = pick;
        }
        await emit({}, "done");
        const capped = !END.has(toks[toks.length - 1]);
        chain.insertAdjacentHTML("beforeend", `<br><span>${capped ? "Stopped at the 12-token limit: no end token was sampled. " : ""}Press Send again: same context, a different sample.</span>`);
      }
    }
    send.addEventListener("click", go);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
  }

  document.querySelectorAll(".streamlab").forEach(build);
})();
