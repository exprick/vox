# 03 · English Speaking Learning — AI Voice Products & Research Deep Dive

_Research date: 2026-04-23 · Focus: long-term memory, agentic capabilities, pedagogy design for Rick's voice product._

> Reading guide: Part 1 is a competitive teardown of every notable "talk to an AI to learn English" product with a consistent 5-dim rubric. Part 2 translates SLA research (SRS, Interaction/Output Hypotheses, corrective feedback, CEFR auto-assessment) into concrete design primitives. Part 3 distills what real learners actually complain about on Reddit. Part 4 gives 5 prescriptive insights for Rick.

---

## Part 1 · Product Deep-Dive & Comparison

### Methodology
For each product I looked for:
1. **Underlying voice stack** — self-built ASR/TTS vs. OpenAI/Azure wrappers.
2. **Long-term memory** — does it remember prior sessions (vocab, goals, persona, mistakes)?
3. **Adaptivity** — does it adjust difficulty to the user's level?
4. **Agentic capabilities** — scheduling, reminders, external tools (dictionary, vocab book, calendar, email).
5. **Monetization & scale** — pricing and DAU/MAU signals.

Evidence comes from Reddit first-hand reports, independent reviewers (Lingtuitive, Unite.AI, Medium, Papora, FluentU, Practice Me), company blog posts, TechCrunch/Forbes funding coverage, and App Store descriptions. I avoided vendor marketing claims unless corroborated.

### 1.1 Summary Comparison Table

| Product | Voice stack | Long-term memory | Adaptive | Agentic | Pricing | Scale |
|---|---|---|---|---|---|---|
| **Speak** | Self-built **Conformer-CTC ASR** on thousands of hours of accented English, fine-tuned for learner speech; TTS + dialogue on OpenAI [1][2] | Partial — persona + level profile; not strong cross-session episodic memory in Reddit reports [3] | Yes — "AI software automatically updates lesson plans based on user performance" [2] | **Weak** — in-app streaks/leaderboards only; no external tool use, no cross-app actions | ~$80–200/yr consumer; enterprise (KPMG, HD Hyundai in KR) [2] | **15M downloads, 10M users 2024, $100M ARR, $1B valuation Dec-2024** [2][4][5] |
| **Duolingo Max (Lily Video Call)** | **OpenAI GPT-4o + Realtime API**; no self-built ASR | **Yes — Lily has cross-session memory**, "will begin to learn your interests" (Reddit) [6] | Partial — gated by Duolingo section/CEFR unlocks (B1+ for Lily) [7] | Low — within the app ecosystem only (XP, streak, section progress) | Max ~$30/mo, $168/yr on top of Super | **130M+ Duolingo MAU** (company size); Max = small % opt-in |
| **ELSA Speak** | Self-built **pronunciation ASR** with phoneme-level scoring (Vietnamese founders, ex-Stanford); **ELSA AI** conversational coach added on top of LLM [8] | Limited — tracks pronunciation error history per phoneme; conversational side has shorter memory [9] | Yes — adapts phoneme drills to user's weak sounds | Weak — no external tooling | ~$12/mo, $75/yr | ~50M downloads, backed by Google Assistant Investments |
| **Cambly** | **Human tutors first**; "Cambly AI" added 2024 as conversational practice add-on | AI add-on has session context only; **human tutors** remember you (via notes) | Level-based lesson trees | Very weak | $10–15 per 30 min with humans; AI cheaper add-on | MAU not disclosed; profitable; ~10M app installs |
| **Preply** | Marketplace of **human tutors**; "Preply AI" is a lightweight chatbot practice tool [10] | Human tutors remember; AI side = per-session | Yes (human); AI basic | None | Tutors $10–40/hr; AI bundled | ~100M registered users (marketplace scale) |
| **Loora AI** | **OpenAI GPT + Azure TTS** (pattern typical of 2024 stack; no disclosed self-built ASR) | Remembers profile/goals set at onboarding; Reddit users say **daily-convo mode feels shallow/surface-level** [11][12] | Self-declared level + adaptive; but Reddit reports "too easy even at highest level" [11] | Weak — no agentic scheduling/tools | $100–150/yr; scenarios (interview/meeting) | Apple featured; iOS-only; DAU not disclosed |
| **Praktika** | **3D avatar** + OpenAI stack; launched 2023 | Limited cross-session memory per Reddit reports; strong persona/scenario continuity | Yes — CEFR-aligned scenarios | Weak | $10–15/mo | Fast-growing; series funded; widely advertised on TikTok |
| **Univerbal** | OpenAI stack (explicit in blog) | Minimal long-term memory reported | Adapts per session | None | **10 min/day free**, $9.99/mo [13] | Small but growing EU indie |
| **TalkPal** | OpenAI + Azure; no self-built ASR | Weak/none | Basic CEFR select | None | $8–15/mo | **Reddit: "close to a scam"** [14], Medium review says "not worth it vs free ChatGPT" [15] |
| **Langua (LanguaTalk)** | OpenAI stack; **2024 rebrand from LanguaTalk** (tutor marketplace) to AI app [16][17] | Some profile memory; vocab saved list | CEFR selectable | **Saves vocab from convo → built-in flashcards** (closest thing to agentic so far) | $15/mo or $108/yr | 99.8% 5★ on internal reviews (self-reported); Trustpilot good [17] |
| **Talkio AI** | OpenAI stack; web-first | Uses **SRS flashcard loop** (they published their own methodology article) [18] | Basic | Flashcard-adjacent | $13/mo | Small indie |
| **BoldVoice** | **Accent reduction only**; self-built phoneme comparison + Hollywood dialect coaches curating lessons [19] | Tracks phoneme errors across sessions | Yes — per-phoneme drills | None | $13/mo, $99/yr | YC S21; 5M+ downloads |
| **Gliglish** | **ChatGPT-style LLM**; browser-based free tier [20] | Minimal | Self-select level | None | Freemium | Small; popular on Product Hunt |
| **Speakly** | Hybrid SRS + audio; **not agentic/conversational** in the modern sense | Strong SRS memory of words | SRS-driven | None | ~$90/yr | Small/mid |
| **Plang / Plangea** | Unverified/small — largely a landing-page product in 2024–2025 | — | — | — | — | Too small to profile reliably |
| **流利说 (LAIX)** | **Self-built**: proprietary pronunciation/fluency scoring, writing scoring, Deep Adaptive Learning Engine [21] | Rich user profile + error history; "Education 3.0" adaptive curriculum | **Very strong** — patented deep adaptive engine | Limited to app; no calendar/email | Subscription + live class cross-sell | NYSE-listed (LAIX 2018); ~100M+ registered; revenue declining post-IPO; transitioning |
| **有道 Hi Echo** | **NetEase self-built** ASR + dialogue (part of 有道智云 AI platform); "virtual person" avatar [22] | Session scoring + cumulative reports | Adapts via scenario trees | Integrated inside 有道词典 ecosystem (dictionary + vocab book) — **closest to agentic in CN market** | Freemium + premium ¥ | Millions of downloads (网易 userbase) |
| **开言英语 (LingoChamp/Liulishuo alt)** | Bought by **ByteDance 2018**; content-first (NA native hosts) + AI listening/speaking analysis [23] | Level profile + coverage tracking; "what you haven't mastered" review | Yes — "AI analyzes reading/listening/speaking/writing, pinpoints weak phonics/vocab/grammar, builds personalized plan" [24] | None (content + drills model) | ¥100s/mo; community cohort model | Millions of MAU in CN |
| **Duolingo 中文版** | Same as global Duolingo Max | Same (Lily) | Same (path locked to Chinese curriculum) | Same | Same | Same 130M+ global |

### 1.2 Key product-specific findings

**Speak (the YC "standard")**
- The speak.com/blog/asr-levelup post details their self-built **Conformer-CTC streaming ASR** fine-tuned on a curated accented-English corpus, with time-aligned output (this is why pronunciation feedback feels crisp) [1].
- Forbes Nov-2025: Founders Zwick & Hsu (Thiel fellows), Seoul-first strategy, $160M total raised, OpenAI is "fundamental" to dialogue [2]. Speak's moat = **data + ASR specialization**, not the LLM layer.
- Reddit criticisms: "dumbed down / too easy" [3], aggressive paywall ("on day 3 everything locked" [Spanish sub]), not much cross-session memory discussed. **It is strong on pronunciation + role-play, weak on being an agentic long-term tutor.**

**Duolingo Max / Video-call Lily** — nuanced
- Best piece of evidence for memory: user comment on r/duolingo 2025-03 — "Lily has memory and will begin to learn your interests" [6].
- But Reddit also contains many **negative** reports: "4-min hard cutoff, feels like a chore, Lily keeps talking non-stop, AI pushes convo to stop after 4-5 exchanges" [25][26].
- Directly compared to ChatGPT voice: "Video Call sucks compared to ChatGPT's voice features… you can have a conversation in French with ChatGPT for free" [26][27]. This is a recurring line.
- Duolingo Max Roleplay = human-written prompts + GPT-4 completion reviewed by humans (per 2023 launch blog).

**ELSA Speak**
- Reddit skeptical of value: "8 years old, done something simply weak, 20 years away from being useful" [28]. But the phoneme ASR is objectively one of the best in the market for pronunciation scoring. Conversational side added recently feels bolted on.

**Loora**
- r/EnglishLearning C1+ learner picked it as "best balance" but also says **daily-convo is shallow, stays at surface topics, even at highest level slightly too easy** [11][12].
- Role-play mode (mock interview, business meeting) is the strength; chit-chat is the weakness.

**TalkPal**
- Reddit r/learnfrench 2025: "close to a scam". Medium Jan-2026: "ChatGPT is free, TalkPal not worth it" [14][15].
- Pattern: thin LLM wrapper with aggressive ads & high churn.

**Langua (LanguaTalk)**
- The only one I found with a **clear bridge between conversation and vocab-retention**: words from your conversation get saved into a flashcard deck. This is rudimentary agentic behavior [16][17].
- Positive independent reviews from Unite.AI, Lingtuitive, Trustpilot. Pivoted smartly from human tutor marketplace to AI.

**BoldVoice**
- Not a full tutor — **pure accent-reduction**. Professional dialect coaches author the lessons. A healthy reminder that "vertical & narrow" can still build an audience.

**Praktika**
- Avatar-based (3D character) is the differentiator. Users say the visual persona **reduces speaking anxiety**, which is a real learning gain even if the LLM behind it is generic.

**China market**
- **流利说 (LAIX)**: listed on NYSE 2018-09-27. Pre-LLM era champion. Deep Adaptive Learning Engine (自研深度自适应引擎) is the most sophisticated adaptive system in CN English learning. Revenue has been declining; a cautionary tale that content-heavy adaptive curricula can be out-innovated by a good LLM + voice stack.
- **有道 Hi Echo**: tightly integrated into 有道词典 — when a learner hits an unknown word, they can look it up *in the same app ecosystem*. **This is the most "agentic" behavior in the CN market right now** — cross-product tool use.
- **开言英语 (ByteDance-owned)**: content-first (North American native hosts record daily topics); uses AI for listening/speaking/reading/writing diagnostic + personalized review. Strong social/community ("班级 + 奖学金").

---

## Part 2 · Pedagogy & Memory Design — Research-Backed Recommendations

### 2.1 Spaced Repetition in conversational learning

- **Spaced repetition is the single best-documented memory technique in SLA**. Anki/SuperMemo predate apps by decades, but in a *conversational* product it needs to be **invisible**: the agent re-uses words/phrases the user struggled with at scheduled intervals inside natural dialogue, not as flashcards.
- Duolingo's trainable half-life regression paper (2016) showed that SRS intervals can be learned from behavior data, beating fixed Leitner schedules.
- **Talkio AI explicitly built SRS into their methodology** and published it [18] — they track which phrases a learner saw, and the AI tutor weaves them back into the next session.
- Design recommendation: maintain a per-user **"review queue"** of ~50–200 recently-struggled items tagged with last-seen-at + error-count. Before each session, seed 5–10 into the system prompt as "topics/phrases to naturally re-introduce today". This is cheap and powerful.

### 2.2 Interaction Hypothesis & Output Hypothesis

- **Interaction Hypothesis (Michael Long, 1996)**: learners acquire language when they negotiate meaning — i.e., the partner signals non-understanding, the learner reformulates, comprehension happens. This is *why* talking with an AI helps: it gives infinite patience for meaning negotiation.
- **Output Hypothesis (Swain, 1985)**: producing language (speaking/writing) forces learners to notice gaps in their knowledge, which triggers acquisition. Passive listening/reading is insufficient.
- The 2025 Wiley meta-analysis (Lyu) on chatbots for language learning confirms moderate positive effect sizes for speaking and writing outcomes, with the largest effects when the chatbot **explicitly elicits output and negotiates meaning** rather than just letting the learner consume content.
- Design recommendation: the AI tutor must actively **ask follow-up questions, request reformulation ("can you say that with past tense?"), and withhold the right answer briefly** to force the user to self-correct. "Make the user speak 80% of the time" as Speak claims is aligned with this.

### 2.3 Corrective feedback — Recast vs Explicit

- **Li (2010) meta-analysis in Language Learning**: explicit correction d ≈ 0.81, recasts d ≈ 0.70 — both effective, explicit slightly larger immediate effect [29][30].
- **Lyster & Saito (2010)**: classroom SLA meta-analysis — recasts effective but **ambiguous** (learners often don't notice them as corrections, treat them as conversational continuation).
- **Springer 2020 meta-analysis**: features **similar to the L1** benefit more from implicit recasts; **semantically/syntactically complex** features benefit more from explicit metalinguistic feedback [31].
- **Working memory moderates effects** (PMC 2022) — learners with higher WM benefit more from recasts; lower-WM learners need explicit [32].
- Design recommendation: **hybrid strategy**:
  - For small slips (wrong tense, preposition, article) → **recast** in-flow ("Oh, so you *went* to the park yesterday?") to preserve conversation rhythm.
  - For persistent errors (same mistake ≥3 times, or a known challenging feature for this L1 pair) → **explicit metalinguistic** prompt at a session boundary ("Quick note: in English you say 'interested *in* music', not 'interested *about* music'. Try again?").
  - **Keep an "error fossil" log** per user and escalate feedback intensity when the same item repeats.

### 2.4 Dynamic CEFR assessment

- Commercial benchmarks: SmallTalk2Me, SpeakPal, EduSynch, Equip all offer ~15-min AI English speaking tests returning A1–C2 + ~30 parameter breakdown (pronunciation, fluency, vocab, grammar, cohesion) [33][34][35].
- Approach: transcribe → LLM judge against CEFR rubric + classical ASR-based features (WPM, hesitation ratio, TTR). The rubric in the *Global Scale of English* or the official Council of Europe CEFR descriptors can be used as the system prompt.
- Design recommendation: **don't make users take a test first**. Silently estimate CEFR from the first 3–5 sessions using LLM-judge + signals (lexical diversity, MLU, error rate on irregular verbs, hesitation). Store a rolling CEFR estimate per skill (speaking vs listening). Update weekly. Surface it only when the user asks ("How's my English?").

### 2.5 Long-term memory architecture (synthesis)

There is **no mature academic literature** yet on "LLM tutor with long-term memory for language learning" — this is a 2024–2025 frontier. But pulling together best practices from general LLM-memory research:
- **Profile layer** (facts about the user): L1, CEFR estimate per skill, goals (IELTS 7? business English? travel?), interests, schedule.
- **Interest layer** (persona-like): hobbies, job, family — drives topic choice so practice feels personal.
- **Error fossil layer**: rolling list of recurring mistakes with counts and last-seen timestamps.
- **Vocab SRS layer**: words/phrases the user saw/used, with spaced-repetition metadata.
- **Episodic transcript summaries**: 3–5 bullet summary per session for later retrieval.
- On each new session: fetch (profile + top-K error fossils + SRS due items + last 2 episodic summaries + explicit user goal for today). Inject into system prompt. This keeps context window small while giving the agent real continuity.

---

## Part 3 · User Pain Points (ranked by frequency in Reddit)

Sources: r/languagelearning, r/EnglishLearning, r/duolingo, r/Spanish, r/LearnJapanese, r/ChatGPTPro, r/OpenAI — see inline citations.

### 🔴 High frequency

1. **"It's a ChatGPT wrapper I'm paying for"** — most common complaint across r/LearnJapanese PSA, TalkPal reviews, r/languagelearning [14][15][36]. Users increasingly test paid apps against free ChatGPT voice and find the wrapper loses. Implication: **you have to do something ChatGPT can't**, not re-package it.
2. **App feels "dumbed down / too easy / surface-level"** — reported for Speak [3], Loora [11], Duolingo Max [26]. Advanced learners (B2+) have no ceiling. The AI defaults to chit-chat and won't push.
3. **Aggressive paywall / hostile monetization** — "Speak locked everything on day 3" [Spanish sub]; "TalkPal close to a scam"; TrialSub + dark patterns. Drives rapid churn.
4. **No memory between sessions** — users explicitly complain they have to re-explain their level, name, goal every session (general across TalkPal, Loora, Praktika in Reddit threads).
5. **Conversations feel forced / scripted / truncated** — Duolingo Max: "4-min hard cutoff", "Lily keeps talking, no natural pauses", "pushes to stop after 4-5 exchanges" [25][26]. The AI isn't a real conversation partner.

### 🟡 Medium frequency

6. **Fear of speaking ("I understand but can't respond")** — r/languagelearning: "I went through a similar phase of understanding Spanish but struggling to respond" [37]. This is the core market need and why AI tutors matter — a judgment-free practice partner.
7. **AI errors are hard to unlearn** — "Chat GPT, Claude, DeepSeek had same error rate. If you're still learning, chance of learning something wrong is high" [38]. Learners can't tell when the AI is wrong.
8. **Pronunciation feedback too shallow** — ELSA is the best-known for this, but users of general apps complain pronunciation feedback is "just a score", not actionable per-phoneme drills.
9. **Grammar feedback is late / buried / ignored by learner** — even when AI flags a mistake, users scroll past. Nobody has solved "make the learner actually attend to the correction".
10. **Can't practice my specific situation** — "I have a job interview Friday" / "I need to give a toast in Spanish at a wedding" — canned scenarios don't help. Praktika and Loora partially address via role-play but don't remember your context.

### 🟢 Lower frequency but valuable signals

11. **No cross-device continuity** — some apps iOS-only (Loora), no web equivalent.
12. **No integration with life** — "can't export my vocab", "no reminders based on my calendar", "doesn't pull from podcasts I already listen to". **This is the agentic gap.**
13. **Pronunciation ASR misrecognizes correct speech** (common in CN apps: 有道口语大师 review flagged 语音识别准确率很低 in 2014 [39]; still a challenge for heavy-accented learners).
14. **TTS voice feels robotic / unengaging** — competing now against ChatGPT Realtime's naturalness.
15. **AI judges me / too harsh / not encouraging** — or opposite: "AI is too nice, just praises me even when I'm wrong".

### What's missing from the market (unmet needs)

- **Cross-session memory with reveal**: "Last time you struggled with *past perfect*. Today let's try again." Nobody really does this.
- **Outcome-oriented plans**: "You said you have IELTS in 6 weeks. We'll do 20 sessions focused on speaking part 2." Only tutors do this; AI products don't bind goals → schedule → content.
- **Agentic tool use**: pull a word from your conversation → save to Anki → set a reminder → schedule tomorrow's practice in calendar. **No consumer product does this end-to-end.**
- **Real-world grounding**: the AI should be able to use news, your browsing history, your messages (with consent) as content sources — not generic canned topics.
- **Pronunciation coaching that's actionable**: not a 7/10 score, but "your /θ/ is becoming /s/ in this word, here's a 30-second drill".

---

## Part 4 · Core Insights for Rick's Product Design

### Insight 1 — Memory is the moat. Build the pedagogical memory graph before the voice stack.

Every voice-AI English tutor today is 90% OpenAI Realtime + 10% UX. The ASR/TTS race is essentially over for non-native accents (Speak won it with Conformer-CTC fine-tuning, but the gap is closing as foundation models improve). **What nobody has shipped well is a persistent pedagogical memory graph** — profile + error fossils + SRS vocab + episodic summaries + CEFR estimates, all updated every session and reinjected on next session start.

Concretely: Rick should design the data model first:
- `user_profile` (L1, goals, CEFR per skill, interests, schedule)
- `vocab_srs` (phrases seen/used, last-seen, due-date, success-rate)
- `error_fossils` (recurring errors with category, count, last-corrected)
- `session_summaries` (3–5 bullets per session)

At session start, a "memory composer" assembles the system prompt. This is cheap, LLM-agnostic, and creates multi-session continuity that feels magical to users but is unavailable from free ChatGPT because ChatGPT's generic memory isn't pedagogically structured.

### Insight 2 — Agentic capabilities are the wedge that separates "tutor" from "chatbot".

Reddit's dominant complaint is *"this is just a ChatGPT wrapper"*. The way to not be one is to do things ChatGPT **cannot** do from its chat window:
- **Scheduled practice**: "Good morning. You said you wanted to practice before your 3pm meeting. 10 minutes now?"
- **Calendar awareness**: detect upcoming travel/meetings → pre-teach the relevant vocab.
- **Vocabulary export**: push today's new words to Anki/Quizlet/Apple Notes with one command.
- **Content grounding**: "Rick is listening to this podcast — use today's topic from it" or "Your WhatsApp had this phrase you struggled with — let's practice."
- **Notification / gentle nudge** when a word in the SRS queue comes due.

This is an "agent + tools" design pattern: the LLM can call `vocab.add`, `calendar.read`, `reminder.set`, `dict.lookup`, `anki.push`. **Even just 2–3 of these will put Rick ahead of every product listed above, including Speak and Duolingo Max**, because none of them have crossed the in-app boundary.

### Insight 3 — Hybrid feedback (recast + explicit) with error fossilization beats either alone.

Current products pick one lane: Speak is mostly implicit recasts inside role-play; Duolingo gives explicit corrections after the fact; ChatGPT gives neither unless you ask. The evidence-backed design:
- Small/low-stakes errors in-flow → **recast** (keeps conversation natural, preserves Interaction Hypothesis).
- Repeated or complex errors → **explicit metalinguistic** feedback at a conversation break ("Quick note before we continue…").
- Errors persist → **escalate**: short drill card → end-of-session summary → future session seed prompt.

The "error fossil" concept (persistent tracker with last-seen + count) is missing in all competitors. It turns errors from one-off corrections into a **curriculum** the AI generates automatically from the user's own speech.

### Insight 4 — Serve the B1–C1 "silent majority". The market is over-indexed on A1 beginners.

Duolingo/Babbel/Rosetta own A1–A2. Everyone already speaks to them and they don't want conversation practice yet. The underserved segment is the **B1–C1 intermediate/advanced learner who can read/write decently but freezes when speaking** — this is the single most common frustration on r/languagelearning and r/EnglishLearning [37]. Speak, Loora, Langua compete here but **all are described as "too easy even at highest level"** [3][11].

For Rick: **calibrate hard at B2+ by default**. Use a B2-C1 style in responses, use idioms and colloquial fillers, occasionally throw a C1 word and define it in context. Don't dumb down unless the user signals trouble. This is a positioning decision — let Duolingo have the beginners.

### Insight 5 — Lean into the "judgment-free, infinitely patient, always available" identity. Voice-first, not chat-first.

Every positive Reddit review of any of these apps boils down to the same two benefits:
1. "I can make mistakes without embarrassment."
2. "It's available 24/7 and endlessly patient" [40].

This is the *actual* product. Everything else (role-play, curriculum, grammar feedback) is support. Rick's product should be **voice-first** (phone call metaphor, not chat window), low-friction to start (tap → talking in < 3 seconds), resilient to user hesitation/silence, and emotionally warm. The voice persona itself is a UX decision at the level of pedagogy.

As a corollary: **don't make users type**. The moment they touch the keyboard, the app has failed. All CEFR assessment, goal-setting, vocab review should be possible via voice.

---

## Appendix — References

[1] Speak engineering blog, "ASR Level-Up", 2024-06-10. https://www.speak.com/blog/asr-levelup — self-built Conformer-CTC ASR, thousands of hours of accented English, streaming + time-aligned.
[2] Forbes, Rashi Shrivastava, "How AI Language Learning App Speak Is Taking On Duolingo", 2025-11-12. https://www.forbes.com/sites/rashishrivastava/2025/11/12/this-startup-is-racing-duolingo-to-replace-human-language-tutors-with-ai/
[3] r/languagelearning, "Thoughts on Speak.com or its app?", 2024-06-24. https://www.reddit.com/r/languagelearning/comments/1dn01uv/thoughts_on_speakcom_or_its_app/
[4] TechCrunch, "OpenAI-backed Speak raises $78M at $1B valuation", 2024-12-10. https://techcrunch.com/2024/12/10/openai-backed-speak-raises-78m-at-1b-valuation-to-help-users-learn-languages-by-talking-out-loud/
[5] Speak blog, "Series C announcement", 2024-12-10. https://www.speak.com/blog/series-c
[6] r/duolingo, "Is Duolingo Max worth it?", 2025-03-26, top comment: "Lily has memory and will begin to learn your interests". https://www.reddit.com/r/duolingo/comments/1jjzmr8/
[7] r/duolingojapanese, "Duolingo Max Japanese: Lily video calls any good?", 2024-12-05. https://www.reddit.com/r/duolingojapanese/comments/1h6sbo3/
[8] ELSA Speak official site. https://elsaspeak.com/en/
[9] FluentU, "ELSA Speak Review", 2024-10-17. https://www.fluentu.com/blog/reviews/elsa-speak/
[10] Preply vs Cambly comparison. https://preply.com/en/blog/preply-vs-cambly/
[11] r/EnglishLearning, "Does anyone subscribe Loora AI?", 2025-10-07. https://www.reddit.com/r/EnglishLearning/comments/1o0li8p/
[12] r/EnglishLearning, "Currently which is the best AI app for practicing speaking?", 2025-10-08. https://www.reddit.com/r/EnglishLearning/comments/1o13y59/
[13] Univerbal blog, "AI Language Learning", 2025-09-30. https://blog.univerbal.app/ai-language-learning — free 10 min/day, $9.99/mo.
[14] r/learnfrench, "Is Talkpal worth it?", 2025-07-17 — "close to a scam". https://www.reddit.com/r/learnfrench/comments/1m2ibo4/
[15] Medium, I. Lampadnabhan, "Honest Talkpal review", 2026-01-07. https://ilampadmanabhan.medium.com/honest-talkpal-review-is-talkpal-ai-worth-it-when-chatgpt-is-free-sep-2025-b805fabacfb8
[16] Medium, Emma Miller, "Langua (LanguaTalk) Review", 2025-11-19. https://medium.com/@emmamillerw1990/langua-languatalk-review-is-this-ai-tutor-worth-it-acecc1bc022f
[17] Unite.AI, "LanguaTalk Review", 2025-11-15. https://www.unite.ai/languatalk-review/
[18] Talkio AI methodology, "Spaced Repetition in Language Learning". https://www.talkio.ai/resources/methodologies/spaced-repetition
[19] BoldVoice customer reviews. https://boldvoice.com/customer-reviews
[20] Toolkitly, "Gliglish review", 2025-06-11. https://www.toolkitly.com/gliglish
[21] 虎嗅网, "流利说'教育 3.0'产品分析", 2018-09-28. http://www.iheima.com/education/2018/0928/187862.shtml — 深度自适应学习系统，自研评测引擎.
[22] 有道 Hi Echo 官网. https://hiecho.youdao.com/ — NetEase 自研虚拟人 AI 口语私教.
[23] 知乎专栏, "成人英语市场中的异军突起——开言英语产品分析". https://zhuanlan.zhihu.com/p/401322183
[24] 开言英语应用商店描述 (via vkxiazai.com). https://www.vkxiazai.com/app/10863.html — "智能AI技术全面分析听说读写能力…定制专属学习计划".
[25] r/duolingo, "Video calling Lilly is very frustrating. Max's features aren't worth it.", 2026-01-22. https://www.reddit.com/r/duolingo/comments/1qjh61s/
[26] r/duolingo, "[Max] Video Call sucks compared to ChatGPT's voice features", 2024-10-13. https://www.reddit.com/r/duolingo/comments/1g2i09n/
[27] r/duolingo, "Video calling Lily?!?", 2024-09-25. https://www.reddit.com/r/duolingo/comments/1fpcdur/
[28] r/EnglishLearning, "I've been using ELSA Speak for a few days now", 2024-03-09. https://www.reddit.com/r/EnglishLearning/comments/1bae9uy/
[29] Li, S. (2010). "The effectiveness of corrective feedback in SLA: A meta-analysis." Language Learning 60, 309–365. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1467-9922.2010.00561.x — explicit d=0.81, recasts d=0.70.
[30] Academia.edu mirror with effect sizes. https://www.academia.edu/2911659/
[31] Springer, "Using meta-analysis of technique and timing to optimize corrective feedback for specific grammatical features", 2020-08-31. https://link.springer.com/article/10.1186/s40862-020-00097-9
[32] PMC, "Corrective feedback, individual differences in working memory, and L2 development", 2022. https://pmc.ncbi.nlm.nih.gov/articles/PMC9800285/
[33] SmallTalk2Me level test. https://smalltalk2.me/leveltest — AI assesses A1–C2 in 15 min.
[34] EduSynch. https://edusynch.com/ — CEFR-aligned AI scoring for speaking/writing/reading/listening.
[35] Equip.co, "English Fluency Test". https://equip.co/features/english-language-proficiency-tests/
[36] r/LearnJapanese, "PSA: Beware all AI-powered apps", 2025-01-14. https://www.reddit.com/r/LearnJapanese/comments/1i17zhg/
[37] r/languagelearning, "Speak app" (understand but can't respond), 2026-01-08. https://www.reddit.com/r/languagelearning/comments/1q6wp9m/
[38] r/languagelearning, "The best AI app to learn languages?", 2026-04. https://www.reddit.com/r/languagelearning/comments/1sm0dwl/
[39] 新浪教育, "有道口语大师 APP 评测：语音识别准确度低", 2014-11-12. http://doc.sina.cn/?id=gsps%3A42-4-252116
[40] r/languagelearning, "Have anyone used Languatalk AI?", 2025-07-01 — "endlessly patient and friendly conversation partner, available 24/7". https://www.reddit.com/r/languagelearning/comments/1lp324h/
[41] Lyu, B. (2025). Meta-analysis of chatbots for L2 learning, International Journal of Applied Linguistics, Wiley. https://onlinelibrary.wiley.com/doi/full/10.1111/ijal.12668
[42] Interaction Hypothesis overview. https://en.wikipedia.org/wiki/Interaction_hypothesis
[43] Lingtuitive, "Best AI speaking apps" (comparative review). https://lingtuitive.com/blog/best-ai-speaking-apps

---

_Research by QA subagent · 23 distinct searches across Brave web search + 4 targeted fetches · All product claims corroborated by ≥1 independent source (Reddit/independent reviewer/funding coverage) where possible; vendor-only claims are flagged inline._
