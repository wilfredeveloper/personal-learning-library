# Teaching notes

## Learner
Shared profile in `../LEARNER.md`. Self-reports are not evidence; quiz results and "your turn" answers are.

## Ground rules for this course
- Each lesson is a companion to one repo section of [https://github.com/w3cj/how-llms-work](https://github.com/w3cj/how-llms-work). Clone it next to
  this library (e.g. `git clone https://github.com/w3cj/how-llms-work`) and read lessons with it open.
  Cite real `file:line` (verify with `grep -n`; never number from a concatenated `cat -n`).
- Run the thing before writing about it; quote real outputs (e.g. the 2.2 s curl in L1).
- Course map: `<div class="pipeline" data-map="how-llms-work" data-here="…">` (keys: chat, neuron, backprop,
  tokens, embed, attn, sample).
- Components added for this course (in `_shared/assets/`): `tokenbars.js` (next-token bars, reuse in L9
  for temperature/top-p), `streamlab.js` (SSE pipe simulator), `.codeblock` CSS.

## Arc
1 pipe (§1) · 2 neuron/XOR (§2) · 3 backprop (§2) · 4 BPE (§3) · 5 embeddings (§4) · 6 attention · 7 block ·
8 training · 9 sampling (§5).

## Log
- Demo course shipped with Personal Learning Library: L1 "Same pipe, different brain" + cheat sheet 1.
  Open: the learner's L1 quiz score and the three "your turn" answers (curl prediction, how the hook tells
  events apart, the `because` rule diff).
