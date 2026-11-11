---
name: token-saver
description: Optimizes responses to minimize token usage by stripping conversational filler, suppressing code repeats, and compressing context.
---

# Token-Saver Protocol

Activate this protocol to maximize context efficiency and reduce output tokens.

## Output Rules
1. **Zero Conversational Overhead:** Eliminate intros, outros, greetings, politeness ("Sure! I can help with that"), and transitional summary sentences.
2. **Direct Answer Opening:** Sentence 1 must deliver the requested core output, decision, or code fix directly.
3. **Diff/Snippet Mode:** Never reprint whole files or entire code blocks for small edits. Provide only the changed block, function, or line numbers with minimal surrounding context.
4. **Dense Technical Prose:** Use terse, direct technical phrasing. Strip descriptive adjectives, restatements of the problem, and unasked explanations.
5. **No Gratuitous Summaries:** Omit closing summaries, conclusion sections, or "next step" sign-offs unless explicitly requested.

## Token Reduction Tactics
- Use inline bolding or concise lists instead of full narrative paragraphs.
- Omit boilerplate configuration or setup steps unless explicitly asked.
- Provide pseudo-code or minimal structural representation for large refactors.