# Vox Truthfile

Vox is a spoken English companion for Chinese-speaking learners. It should feel like a patient conversation partner who remembers how the learner speaks, notices when they stop understanding, and changes the conversation before the learner has to explain the problem.

Vox is not a generic chatbot, a fixed lesson player, or a correction machine. The product promise is: the learner can keep talking, understand enough to stay in the conversation, and gradually need less Chinese support.

> Updated: 2026-05-18

## Current Bet

First prove one question: can Vox speak at a level this learner can actually follow right now?

The first prototype should not try to solve every long-term tutoring problem. It should make the learner feel three things in one live session:

- Vox starts conservatively instead of assuming the learner's level.
- Vox notices whether the learner understood the last turn.
- Vox changes the next turn's language mix, speed, and explanation style without restarting the session.

## Delivery Boundary

Vox ships as a Web App first. A learner signs in with Google so Vox can keep that learner's memory separate from everyone else's, and early access stays invite-only before a live voice session starts.

Google-only is acceptable for the Web App MVP. If native iOS returns, add Sign in with Apple or an equivalent App Store-compliant login option before App Store distribution.

Supabase is the first auth and data boundary: Supabase Auth handles Google OAuth, Supabase Postgres stores learner profiles and session summaries, and RLS must prevent one user from reading or writing another user's data.

Google login proves identity, but it does not make Vox private by itself. The backend still needs an email or domain allowlist before the learner enters a live session.

## Product Shape

### Adaptive Conversation Lanes

Vox should carry several conversation lanes and move between them during the same session.

| Lane | What the learner hears | When Vox uses it |
| --- | --- | --- |
| Chinese support | Mostly Chinese, with short English phrases | The learner is new, blocked, or needs the meaning first |
| Guided English | Simple English plus Chinese rescue lines | The learner can follow short turns but still needs support |
| English-first coaching | English explanations, with Chinese only when needed | The learner can follow the topic but misses nuance |
| Natural English | English conversation with light coaching | The learner can keep the conversation moving |

The important behavior is not the labels. The important behavior is that Vox can move down when the learner is lost and move up when the learner is following easily.

### Understandability Check

Vox needs a gentle way to answer: "Can this learner understand this level of spoken English right now?"

The check should feel like conversation, not an exam:

1. Start with a familiar topic.
2. Ask one short English question.
3. Look for evidence that the learner understood the meaning, not just whether they answered with perfect grammar.
4. If they understood, try one slightly harder turn.
5. If they did not, repeat the idea with simpler English or Chinese support.

The success signal is simple: the learner can keep responding without constantly asking Vox to repeat, translate, or slow down.

### Learner Memory

Vox should remember the learner's learning profile, not store raw private conversation as the source of truth.

The first memory system should stay small and structured:

- Current listening comfort: what length, speed, and vocabulary the learner can usually follow.
- Chinese support preference: how much Chinese helps without making the session feel like translation.
- Conversation topics: familiar topics that make speaking easier.
- Recent trouble spots: phrases, sounds, grammar patterns, or question types that repeatedly block the learner.
- Useful coaching style: whether the learner responds better to direct correction, recasts, examples, or quick drills.
- Review queue: a short list of things Vox should naturally bring back later.

After each session, Vox should update this profile with a short learning summary. The next session should begin from the profile instead of starting from zero.

### Recommended Memory Direction

Start with a structured learner profile plus session summaries. Do not make a large semantic memory store the first source of truth.

Reason: the product needs stable tutoring behavior more than broad recall. A compact profile is easier to inspect, safer to change, and directly useful for choosing the next conversation lane.

Semantic recall can come later for examples, favorite topics, or long-running personal context. It should support the learner profile, not replace it.

## Prototype Acceptance

The first usable demo passes when:

- Vox begins with a conservative conversation lane.
- Vox can detect "understood", "partly understood", and "lost" from the live exchange.
- Vox changes the next turn's English difficulty and Chinese support based on that signal.
- Vox saves a short learner profile after the session.
- A later session starts with that saved profile and feels different from a brand-new user session.

The product test is: at this level, can the learner follow Vox without constantly stopping the conversation?

## Writing Rule

Write Vox product docs in user-facing capability language. Avoid describing the feature as "a prompt", "a vector database", or "an evaluator" unless the document is specifically for implementation.
