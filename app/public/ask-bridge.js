// Injected into every embedded lesson. On a text selection it shows a small
// "Ask the tutor" popover with three depths (Simple, Mid, Deep); clicking one
// posts the selection, the depth and the surrounding context to the parent app window (which opens the tutor), and leaves the passage
// marked in the lime highlighter so you can see what the answer is about.
(function () {
  "use strict";
  var pop = null;

  var css = document.createElement("style");
  css.textContent =
    ".ask-tutor-pop{position:absolute;z-index:99999;transform:translateY(-100%);" +
    "font:600 12.5px/1 Inter,system-ui,sans-serif;" +
    "background:#19221f;color:#f4f6f2;border:1px solid #19221f;border-radius:3px;" +
    "padding:4px 4px 4px 12px;display:flex;align-items:center;gap:8px;" +
    "box-shadow:0 6px 18px -6px rgba(25,34,31,.45)}" +
    ".ask-tutor-pop button{font:inherit;color:inherit;background:transparent;border:0;border-radius:2px;" +
    "padding:6px 9px;cursor:pointer}" +
    ".ask-tutor-pop button:hover{background:#234be7}" +
    ".ask-tutor-pop::before{content:'';width:8px;height:8px;border-radius:50%;background:#ddf59e}" +
    "::highlight(asked){background-color:#ddf59e;color:#19221f}" +
    // External links, as publishing marked them (scripts/sync-courses.mjs): on the canvas a lime
    // dot (or a PDF tag) means it opens beside the lesson; ↗ means it can only open in a browser tab.
    ".in-canvas a[data-open=canvas]::after{content:'';display:inline-block;width:.42em;height:.42em;margin-left:.28em;" +
    "border-radius:50%;background:#ddf59e;border:1px solid #19221f;vertical-align:.12em}" +
    ".in-canvas a[data-open=canvas][data-kind=pdf]::after{content:'PDF';width:auto;height:auto;padding:.18em .32em;border-radius:2px;" +
    "font:600 .6em/1 Inter,system-ui,sans-serif;color:#19221f;vertical-align:.18em}" +
    "a[data-open=tab]::after{content:'\\2197';margin-left:.15em;font-size:.85em;opacity:.65}";
  document.head.appendChild(css);
  if (window.frameElement && window.frameElement.dataset.canvas) document.documentElement.classList.add("in-canvas");

  function clear() {
    if (pop) { pop.remove(); pop = null; }
  }

  function nearestHeading(el) {
    while (el) {
      var p = el;
      while (p) {
        if (/^H[1-3]$/.test(p.tagName || "")) return p.innerText.trim();
        p = p.previousElementSibling;
      }
      el = el.parentElement;
    }
    return "";
  }

  document.addEventListener("mouseup", function () {
    // On the canvas the parent page handles highlights itself.
    if (window.frameElement && window.frameElement.dataset.canvas) return;
    var sel = window.getSelection();
    var text = sel ? sel.toString().trim() : "";
    clear();
    if (!text || text.length < 2) return;

    var range = sel.getRangeAt(0);
    var rect = range.getBoundingClientRect();
    var node = range.startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    var block = node.closest ? node.closest("p,li,figure,div,h1,h2,h3,blockquote") : null;

    pop = document.createElement("div");
    pop.className = "ask-tutor-pop";
    pop.appendChild(document.createTextNode("Ask the tutor"));
    pop.style.top = window.scrollY + rect.top - 8 + "px";
    pop.style.left = window.scrollX + rect.left + "px";
    document.body.appendChild(pop);

    [["simple", "Simple"], ["mid", "Mid"], ["deep", "Deep"]].forEach(function (lv) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = lv[1];
      b.dataset.level = lv[0];
      pop.appendChild(b);
    });

    pop.addEventListener("mousedown", function (ev) {
      ev.preventDefault();
      var level = ev.target.dataset && ev.target.dataset.level;
      if (!level) return;
      parent.postMessage(
        {
          type: "ask-claude",
          level: level,
          selection: text,
          heading: nearestHeading(block || node),
          context: block ? block.innerText.slice(0, 1200) : "",
          title: document.title,
        },
        window.location.origin,
      );
      if (window.CSS && CSS.highlights && window.Highlight) {
        CSS.highlights.set("asked", new Highlight(range.cloneRange()));
        sel.removeAllRanges();
      }
      clear();
    });
  });

  document.addEventListener("scroll", clear, true);
  document.addEventListener("mousedown", function (e) {
    if (pop && !pop.contains(e.target)) clear();
  });
})();
