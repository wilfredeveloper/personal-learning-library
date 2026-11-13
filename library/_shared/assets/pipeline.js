/* "You are here" map of a course's pipeline, shared by every lesson so the course
   reads as one map. Markup: <div class="pipeline" data-here="train"></div>
   (data-here is optional; omit it to show the whole pipeline without a highlight).
   data-map picks the course's map (a key of MAPS below). */
(function () {
  const MAPS = {};
  MAPS["how-llms-work"] = [
    ["chat", "Chat", "§1 the pipe"],
    ["neuron", "Neuron", "§2 XOR wall"],
    ["backprop", "Backprop", "§2 learning"],
    ["tokens", "Tokens", "§3 BPE"],
    ["embed", "Embeddings", "§4 word2vec"],
    ["attn", "Attention", "§5 transformer"],
    ["sample", "Generate", "§5 sampling"],
  ];
  // Add a map per course here: MAPS["<course-folder>"] = [[key, name, sub], ...].
  document.querySelectorAll(".pipeline").forEach((el) => {
    const here = el.dataset.here;
    const STAGES = MAPS[el.dataset.map] || [];
    el.setAttribute("role", "list");
    el.setAttribute("aria-label", "Pipeline stages");
    STAGES.forEach(([key, name, sub]) => {
      const s = document.createElement("div");
      s.className = "st" + (key === here ? " here" : "");
      s.setAttribute("role", "listitem");
      if (key === here) s.setAttribute("aria-current", "step");
      s.innerHTML = `<b>${name}</b><span>${sub}</span>`;
      el.appendChild(s);
    });
  });
})();
