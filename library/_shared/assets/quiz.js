/* Retrieval-practice quiz component.
   Markup:
     <div class="quiz" data-correct="b">
       <p class="q">Question?</p>
       <div class="opts">
         <button class="opt" data-k="a">…</button> …
       </div>
       <p class="why" hidden>Explanation shown once answered correctly.</p>
     </div>
   Wrong picks are struck through and the learner keeps trying (retrieval, not recognition).
   A <p class="score" data-quiz-score></p> anywhere on the page shows first-try accuracy.
   When framed (the study app), each answer is also posted to the parent window as
   { type: "lesson-event", kind: "quiz", section, q, right, first }. */
(function () {
  const quizzes = Array.from(document.querySelectorAll(".quiz"));
  const scoreEls = document.querySelectorAll("[data-quiz-score]");
  const state = new Map();

  function renderScore() {
    const done = [...state.values()].filter((s) => s.solved);
    const first = done.filter((s) => s.misses === 0).length;
    scoreEls.forEach((el) => {
      el.textContent = done.length
        ? `${first} of ${quizzes.length} right on the first try · ${done.length}/${quizzes.length} answered`
        : `${quizzes.length} questions · answer from memory before scrolling back up`;
    });
  }

  // Tell the study app about an answer. Only when framed; never breaks the quiz.
  function post(quiz, right, first) {
    try {
      if (window.parent === window) return;
      const h2s = [...document.querySelectorAll("h1, h2")] // the h1 names the part above the first h2
        .filter((h) => h.compareDocumentPosition(quiz) & Node.DOCUMENT_POSITION_FOLLOWING);
      const section = h2s.length ? h2s[h2s.length - 1].textContent.replace(/\s+/g, " ").trim() : "";
      const qEl = quiz.querySelector(".q");
      const qCopy = qEl ? qEl.cloneNode(true) : document.createElement("p");
      qCopy.querySelectorAll(".katex-mathml").forEach((m) => m.remove()); // KaTeX: keep the visible copy only
      const q = qCopy.textContent.replace(/\s+/g, " ").trim().slice(0, 300);
      window.parent.postMessage({ type: "lesson-event", kind: "quiz", section, q, right, first }, "*");
    } catch (e) { /* logging must never break the quiz */ }
  }

  quizzes.forEach((quiz, i) => {
    const correct = quiz.dataset.correct;
    const why = quiz.querySelector(".why");
    const tryAgain = document.createElement("p");
    tryAgain.className = "try";
    tryAgain.hidden = true;
    tryAgain.setAttribute("role", "status");
    quiz.appendChild(tryAgain);
    state.set(i, { solved: false, misses: 0 });

    quiz.querySelectorAll("button.opt").forEach((btn) => {
      btn.type = "button";
      btn.addEventListener("click", () => {
        const s = state.get(i);
        if (s.solved || btn.disabled) return;
        const first = !s.answered;
        s.answered = true;
        if (btn.dataset.k === correct) {
          s.solved = true;
          btn.classList.add("right");
          quiz.querySelectorAll("button.opt").forEach((b) => (b.disabled = true));
          tryAgain.hidden = true;
          if (why) why.hidden = false;
        } else {
          s.misses += 1;
          btn.classList.add("wrong");
          btn.disabled = true;
          tryAgain.textContent = btn.dataset.hint || "Not this one. Try again.";
          tryAgain.hidden = false;
        }
        renderScore();
        post(quiz, s.solved, first);
      });
    });
  });
  renderScore();
})();
