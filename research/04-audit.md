# 04 · Research Audit — Teacher 市场与产品假设复核

> 审计日期：2026-04-24  
> 审计目标：不默认接受 OpenClaw 结论，重新检查“实时语音 × agentic 工具 × 长期记忆”的市场空位，以及 Teacher 的产品定位是否仍成立。

## 结论先行

OpenClaw 的大方向基本成立：**专门面向语言学习、同时具备低延迟语音、跨 session 教学记忆、以及跨出 app 的工具执行**，仍然是一个明确机会。

但原调研有几个表述过满：

1. **“消费端没有任何产品把三项同时做好”需要收窄。** ChatGPT 的消费端 Voice 仍不支持 apps/connectors；但 Gemini Live 已经在 Android 上逐步支持 Calendar/Tasks/Keep 等 Connected Apps。它不是语言学习产品，也不是开放自定义 agent 平台，但已经削弱了“巨头 voice 全无 agentic”的说法。
2. **“英语学习类 App 全员没有记忆”不准确。** Langua 已公开提供 smart memory、SRS flashcards、把保存词汇编回对话、基于常犯错误生成 grammar drills。它仍缺少跨 app 工具执行，但它已经逼近 Teacher 的“教学记忆图谱”一部分。
3. **“B2+ 被行业集体放弃”方向有价值，但不能当事实定论。** Langua 明确打 intermediate plateau，Loora/Praktika/Speak 也覆盖中高级口语练习。更准确的说法是：B2-C1 用户仍认为很多产品太浅，但已有产品在争夺这个区间。
4. **教学法引用需要更谨慎。** Recast vs explicit correction 的效果不是简单“explicit 0.81, recast 0.70”。Li 2010 表格里 explicit correction immediate effect 更高，但 recast 是中等效果，且长期效果可能保留；策略结论仍可用，但数字不要随手写死。

修正后的核心 thesis：

> Teacher 不应押注“市场没人做 AI 口语陪练”。市场已经很拥挤。真正可防守的机会是：**一个 voice-first 的语言学习 agent，把长期教学记忆做成可审计的数据模型，并能把用户现实生活中的材料、日程、提醒、Anki/Quizlet 等工具接进练习循环。**

## 已确认仍成立的点

### 1. ChatGPT 消费端 Voice 仍不是完整 agentic surface

OpenAI Help Center 当前写明：ChatGPT Voice 支持 GPTs 语音对话，但 voice mode 仍不支持 image generation、file uploads、Code Interpreter，GPT custom actions 也不可用；Apps in ChatGPT 页面也明确写着 Voice mode 不支持 apps。

这支持 OpenClaw 的关键判断：**ChatGPT app 的 voice mode 和 ChatGPT text/app connector 生态之间仍有断层。**

但要区分两件事：

- **ChatGPT 消费端 voice**：工具/应用能力受限，是 Teacher 可以差异化的参照物。
- **OpenAI API / Agents SDK / Realtime**：已经支持 voice agents 和 tools。OpenAI 官方 Voice Agents 文档展示了 Python `VoicePipeline` + `function_tool`，Realtime 文档也推荐 WebRTC 连接实时语音模型。

产品策略含义：Teacher 不能说“OpenAI 做不到 voice agentic”，只能说“ChatGPT 消费端默认体验还没有把这些能力包装成语言学习产品”。

Sources:
- [OpenAI Voice Mode FAQ](https://help.openai.com/en/articles/8400625-voice-mode)
- [Apps in ChatGPT](https://help.openai.com/en/articles/11487775-connectors-in-chatgpt)
- [OpenAI Voice agents docs](https://developers.openai.com/api/docs/guides/voice-agents)
- [OpenAI Realtime WebRTC docs](https://developers.openai.com/api/docs/guides/realtime-webrtc)

### 2. Gemini 是最大的“原结论修正项”

Gemini Live API 官方支持 function calling 和 Google Search，Live API tool docs 当前列出 Gemini 3.1 Flash Live Preview / Gemini 2.5 Flash Live Preview 都支持 function calling。

更重要的是，Gemini consumer Live 帮助页写明：Gemini Live chats 已逐步支持 Connected Apps，包括 Google Calendar、Google Tasks、Google Keep，以及部分 Android 厂商日历/便签/提醒 app；Google Maps 公共信息也可自动用于 Live chats。

但 Gemini 的长期记忆在 Live 中仍有限：Google 的 personalization help page 明确写着 memory of past Gemini chats 目前不适用于 Live chats；不过在 text chat 里可以要求 Gemini reference past Gemini Live conversation。

所以 Gemini 现在的状态更准确地说是：

| 能力 | Gemini Live 当前情况 |
| --- | --- |
| 实时语音 | 强 |
| Agentic / Connected Apps | 已逐步具备，但 app 列表有限，且强依赖 Android / Google 生态 |
| 长期记忆 | 个人账号有 past-chat personalization；但该 memory feature 不适用于 Live chats |
| 语言学习专用记忆 | 没看到结构化错误/词汇/SRS/CEFR 记忆 |

产品策略含义：Teacher 需要假设 Google 会继续把 Live、Apps、Memory 打通。Teacher 的护城河不能只是“voice + calendar”，而应该是**教学记忆模型 + 语言学习工作流**。

Sources:
- [Gemini Live API tool use](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Gemini Live help: Connected Apps in Live chats](https://support.google.com/gemini/answer/15274899)
- [Gemini personalization with past chats](https://support.google.com/gemini/answer/16598469)

### 3. 英语学习产品确实缺少“跨出 app 的 agentic”

Speak、Duolingo Max、ELSA、Babbel Speak、Loora、Praktika、Langua 都在补 AI conversation / feedback / personalization。但我没有找到主流英语学习产品提供类似以下 end-to-end 工作流：

- 从今天对话自动抽取词汇并推到用户自己的 Anki deck
- 读取用户日历，把明天真实会议/面试变成今日练习
- 给 due vocab 设置系统级提醒
- 拉取用户指定 podcast/video transcript 做个性化教材

Langua 已经有 app 内的 SRS、saved vocab、vocab-focused chats、smart memory 和 grammar drills，是最接近 Teacher 记忆图谱的竞品；但它仍是语言学习 app 内闭环，不是跨 app agent。

Sources:
- [Langua AI tutor features](https://languatalk.com/ai-language-tutor)
- [Langua flashcards / spaced repetition](https://support.languatalk.com/article/136-how-do-the-flashcards-work)
- [ELSA real-time feedback for AI conversations](https://elsanow.freshdesk.com/en/support/solutions/articles/31000177727-real-time-feedback-for-ai-conversations)
- [Babbel Speak launch](https://www.babbel.com/press/en-us/releases/babbel-speak)

### 4. Duolingo Video Call 是真实竞品，不只是“被骂的 feature”

原文把 Duolingo Max 的缺点写得比较重，但现在需要加上正面证据：Duolingo 自己发布了 Video Call efficacy whitepaper，研究对象是 658 名日语母语英语学习者，Video Call 使用组 30 天后 speaking score gain 高于 control，论文声称提升幅度为 43.7% greater。

同时，Duolingo 官方 blog 写明 Lily Video Call 会根据用户程度调整，并且早期课程约 1 分钟，高级一点可到 3 分钟；白皮书也写明 Video Call 不提供实时口语反馈，而是在结束后 transcript 里给反馈和 tips。

产品策略含义：Teacher 不应把 Duolingo Max 描述成“玩具”。更好的差异化是：

- Teacher 不锁在 Duolingo path / CEFR section 内
- Teacher 允许长对话
- Teacher 有实时或准实时纠错策略
- Teacher 有跨 session 的错误和词汇记忆
- Teacher 能接入用户真实生活和外部工具

Sources:
- [Duolingo Video Call blog](https://blog.duolingo.com/video-call/)
- [Duolingo Video Call Android launch](https://investors.duolingo.com/node/10476/pdf)
- [Duolingo 2025 Video Call whitepaper](https://duolingo-papers.s3.amazonaws.com/reports/Duolingo_whitepaper_language_video_call_improves_speaking_2025.pdf)

## 需要修正或降置信度的原判断

### A. “没有任何一款消费端产品三项齐备”

建议改成：

> 截至 2026-04，尚未看到一款**语言学习专用消费产品**同时做好：低延迟 voice-first 对话、可审计的长期教学记忆、以及跨 app agentic 工具执行。通用助手中，ChatGPT Voice 缺 app/tool surface，Gemini Live 已开始接入部分 apps 但 Live memory 与教学记忆仍弱。

原因：Gemini Live 的 Connected Apps 已经使原表述太绝对。

### B. “Langua 只是 rudimentary agentic”

原调研低估了 Langua。它已经有：

- Call Mode
- Smart memory
- SRS flashcards
- Saved vocab from chats/videos/podcasts
- Vocab-focused chats
- AI-generated stories with saved vocab
- Personalized grammar drills based on frequent mistakes

这几项直接撞上 Teacher 的 `vocab_srs` 和 `error_fossils`。Teacher 不能只做“记住生词和错题”，必须做得更透明、更自动、更贴近真实生活。

### C. “默认 B2-C1”需要用户验证

B2-C1 “沉默型高阶学习者”是合理切入点，但有两个风险：

- B2-C1 用户更容易直接使用 ChatGPT/Gemini，而不是再装一个学习 app。
- 这个人群对纠错质量、话题深度、口音反馈、文化语用反馈要求更高，MVP 很容易显得浅。

建议把定位改成更具体的 wedge：

> B2-C1、已有真实英语任务的人：面试、会议、presentation、sales call、IELTS speaking、海外生活社交。  
> 产品不是“练英语聊天”，而是“把你未来一周真实会说的英语预演并记住你的弱点”。

### D. LiveKit + Letta 是合理路线，但不是唯一合理路线

GitHub API 当前核验：

| 项目 | Stars | 最近 push | 审计判断 |
| --- | ---: | --- | --- |
| pipecat-ai/pipecat | 11.5k | 2026-04-24 | 活跃，pipeline 心智强，Mem0 集成官方可查 |
| livekit/agents | 10.2k | 2026-04-24 | 活跃，客户端/WebRTC/SIP 生态更强 |
| mem0ai/mem0 | 53.9k | 2026-04-23 | 最流行通用 memory layer |
| letta-ai/letta | 22.2k | 2026-04-12 | stateful agent 平台，适合“每个学生一个 agent” |
| getzep/zep | 4.5k | 2026-04-09 | memory/KG 服务，LiveKit 集成文档存在 |
| getzep/graphiti | 25.3k | 2026-04-22 | KG memory 底座，适合后期结构化关系 |

LiveKit + Letta 仍适合 v0，但我会把 MVP 的 memory 设计和框架选择解耦：

- `teacher-memory-schema` 是自有核心，不应该完全交给 Letta/mem0 黑盒。
- Letta/mem0/Zep 可作为 storage/retrieval backend。
- MVP 里至少把 `error_fossils` 和 `vocab_srs` 存在自家 Postgres 表中，避免未来换 memory backend 时丢掉产品核心。

Sources:
- [LiveKit Letta plugin](https://docs.livekit.io/agents/models/llm/letta/)
- [Pipecat Mem0 integration](https://docs.mem0.ai/integrations/pipecat)
- [Zep LiveKit voice agents](https://help.getzep.com/livekit-memory)
- GitHub API snapshots: [LiveKit Agents](https://github.com/livekit/agents), [Pipecat](https://github.com/pipecat-ai/pipecat), [mem0](https://github.com/mem0ai/mem0), [Letta](https://github.com/letta-ai/letta), [Zep](https://github.com/getzep/zep), [Graphiti](https://github.com/getzep/graphiti)

## 更强的产品定义

### Revised Positioning

Teacher 是一个 **voice-first language rehearsal agent**：

> 它记住你真实要面对的英语任务、反复犯的错误和该复习的表达；每次通话都围绕你的现实语境推进，并能把练习结果写回你的工具链。

这个定位比“AI 英语陪练”更窄，但更难被 ChatGPT/Langua/Duolingo 直接替代。

### MVP 不应平均用力做五层记忆

建议 MVP 只做三层，且全部可见、可测：

1. `user_profile`: L1、目标、真实任务、兴趣、可练习时间。
2. `error_fossils`: 错误表达、标准表达、类别、出现次数、最近一次、反馈策略。
3. `vocab_srs`: 词/短语、来源句、用户是否主动用出、due_at、success_rate。

`session_summaries` 可以做，但只是辅助；`cefr_estimate` 容易伪科学化，v0 先只做内部粗估，不要展示分数。

### MVP 的 3 个 agentic tools

优先级建议：

1. `calendar.read_next_week()`  
   用用户真实事件生成 roleplay，比 generic topic 更有差异化。
2. `vocab.export_to_anki(words)`  
   用已有学习工作流拉高留存；即使先做 CSV/AnkiConnect，也比 app 内孤岛强。
3. `reminder.set_review(time, items)`  
   把 SRS 从“记录”变成行为闭环。

`podcast.pull_transcript(url)` 很有吸引力，但版权、转写质量、内容清洗和延迟会拖 MVP。建议放 W2/W3 之后。

### 关键体验指标

不要只测“能否通话”。应在 5-10 个真实用户 session 中测：

- 用户发言时间占比是否 > 70%
- 每 session 是否产生 3-8 条高质量 `error_fossils` / `vocab_srs`
- 下一次 session 是否自然复现上次 3 个以上记忆点
- 用户是否感到“它真的记得我”，而不是“它念了摘要”
- agentic tool 使用率：有多少用户愿意真的导出 Anki / 读日历 / 设提醒

## 下一步调研建议

1. **手测 Langua、Duolingo Max、Gemini Live。** 这是现在最值得花钱测的三类：垂直竞品、学习巨头、通用巨头。
2. **访谈 5 个 B2-C1 用户。** 不问“你想不想学英语”，只问过去两周真实卡住的英语任务、当前用什么工具、是否用 Anki/日历/提醒。
3. **做一轮 memory smoke test。** 同一个用户连续 3 天通话，每天插入 5 个错词/错句，测试系统是否能在第 3 天自然带回并纠错。
4. **用 API 快速试跑两条栈。** LiveKit + Letta 与 Pipecat + mem0 各跑一次 hello-world，并记录端到端延迟、工具调用稳定性、memory 注入可控性。

## Bottom Line

原调研最有价值的部分是“记忆图谱 + agentic 外挂”这个方向；最危险的部分是把竞品说得太弱。2026 年的语言学习 AI 市场不是空白市场，而是一个快速拥挤的市场。

Teacher 要赢，不能只是“另一个会说话的 tutor”。它必须证明三件事：

1. 它比 ChatGPT/Gemini 更懂语言学习。
2. 它比 Langua/Duolingo 更会记住你的真实弱点。
3. 它比所有学习 app 更能接入你的真实生活和工具链。
