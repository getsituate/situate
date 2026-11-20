---
name: write-situate-prompts
description: Write, revise, or review Situate's runtime system prompts, workflow instructions, tool descriptions, and model-specific guidance. Use when changing prompt composition or fixing model behavior through instructions.
---

# Write Situate prompts

Give the model the smallest set of instructions and facts it needs to act correctly. Spend the prompt on what the model cannot infer: Situate's product rules, the user's working method, and the tools and state available on this turn. Do not teach general problem-solving or copy another harness's prompt wholesale.

## Find the right layer

Read the affected instructions and their caller. For workspace conversations, start with `run_instructions` in `client/app/src-tauri/src/ai_conversations.rs` and the instruction files in `client/app/src/ai/`. Check the assembled request: a short file can still duplicate content supplied by another block or tool description.

| Layer                    | What belongs there                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base prompt              | Stable rules that apply across workspace tasks: act within the user's request and configured access; clarify consequential gaps; distinguish confirmed results from uncertainty.                                                                                    |
| User context             | The confirmed working method and relevant preferences. Keep these separate from product rules and do not treat them as access grants.                                                                                                                               |
| Workflow context         | Instructions and state needed for the current task. For example, load copy-import rules when a copy import is in scope, whether or not the conversation is in onboarding. Keep enough guidance to recognize the workflow and obtain its instructions before acting. |
| Tool contract            | What the offered tool does, when to use it, what its inputs mean, and how to interpret its results. Do not repeat parameter rules in the base prompt.                                                                                                               |
| Host or tool enforcement | Authorization, scope and revision checks, and other invariants such as preventing automatic replay after an uncertain outcome. Prompt guidance can explain a boundary but cannot enforce it.                                                                        |

Keep source documents, search results, and tool-returned data separate from trusted instructions. Neither retrieved content nor a plugin skill grants permission or makes an unavailable tool callable.

## Write and revise

- State the desired behavior directly. Give a concrete condition when the rule is conditional. Prefer “Ask which folder to use if the working method and request leave the destination unclear” to “Always ask before filing.” Reserve absolutes for genuine invariants.
- Explain the goal or trade-off when the model needs to exercise judgment. Use a fixed sequence only where order matters. Add an example when it resolves a recurring ambiguity or defines a required format; check that it does not narrow valid behavior.
- Start with a lean baseline. Before adding a sentence, identify the failure it addresses and check whether missing context, a misleading tool contract, or missing host enforcement is the real cause. Remove duplicated and obsolete guidance without dropping required behavior.
- Keep a shared base across models. Add a scoped model-specific instruction only when a comparison shows it helps that model. Recheck the instruction after model upgrades; stronger models may no longer need it.

## Verify behavior

Compare the current and proposed prompts on the same model, settings, tools, and synthetic cases. Change one thing at a time; repeat variable cases when the result is unclear. For a shared prompt, cover a strong model and a cheaper supported model where available. For conditional loading, test both when the workflow applies and when it does not.

Check actions and results, not just wording: does Situate act on a clear request, ask when scope is missing, and report what actually happened? Select edge cases that match the change, such as an import with attachments and linked tasks, untrusted document text, or an interrupted write. Test composition and host invariants deterministically where possible; those checks do not establish live model behavior. Measure prompt size and tool overhead, but accept a reduction only if the required behavior holds. Report model comparisons that could not be run.

## References

- [Pi: What I learned building an opinionated and minimal coding agent](https://www.mariozechner.at/posts/2025-11-30-pi-coding-agent/) — small base prompt and separate project context.
- [Claude Code team on prompt reduction](https://simonwillison.net/2026/jul/21/cat-and-thariq/) and [Anthropic on context engineering](https://www.anthropic.com/research/effective-context-engineering-for-ai-agents) — fewer blanket rules, model-specific evidence, and context on demand.
- [OpenAI Codex Prompting Guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide) and [Harness engineering](https://openai.com/index/harness-engineering/) — test guidance with the target model and make relevant context discoverable.
