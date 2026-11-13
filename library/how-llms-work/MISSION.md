# Mission: How LLMs work, from the how-llms-work repo

> This is the demo course that ships with Personal Learning Library. Rewrite this file in your own words
> (or ask `/teach how-llms-work` to redo it with you) so the teacher grounds lessons in *your* reason.

## Why
Work through [w3cj/how-llms-work](https://github.com/w3cj/how-llms-work) section by section and come out understanding every
stage of an LLM, from the streaming pipe to a transformer trained by hand, well enough to read the
code, derive the maths, and change it.

## Success looks like
- Trace any repo route end to end (route → emit → SSE → readSSE → hook) and explain what the brain computes
- Derive, with real formulas, the chain rule of probability, backprop, BPE, skip-gram with negative
  sampling, scaled dot-product attention, layer norm, cross-entropy and Adam, and point to the line
  of the repo that implements each
- Modify the repo (a new chat rule, a tokenizer tweak, a transformer hyperparameter) and predict the effect before running it
- Read the core papers the repo cites (Vaswani 2017, Mikolov 2013, Kingma & Ba 2014, Holtzman 2019) without getting lost

## Constraints
- Visual first, then code, then the formula (KaTeX, every symbol defined beside it)
- Lessons are short and dense; one repo section per lesson or two
- Learns by reading code in the repo alongside the lesson

## Out of scope (for now)
- GPU kernels, PyTorch internals, distributed training at scale
- Finetuning, quantization and on-device deployment
- RLHF / post-training
