# 商业语音 AI 产品能力调研

> **调研时间：** 2026-04-23
> **调研者：** QA Agent (subagent)
> **方法论：** Brave 搜索 + 独立测评 + Reddit/HN 用户反馈优先，官网宣传仅做参考
> **评分标准：**
> - **语音通话**：实时双向语音交互（非单向 TTS 播报）
>   - ✅ = 低延迟全双工实时语音
>   - ⚠️ = 有限/高延迟/半双工
>   - ❌ = 仅 TTS 或无语音
> - **Agentic 能力**：能真实调用工具/API 执行世界动作（发邮件、查日历、订外卖、调 MCP）
>   - ✅ = 生产级工具调用，能完成真实任务
>   - ⚠️ = 有 function calling 但受限（常见：voice 模式下不能用工具）
>   - ❌ = 纯对话/ roleplay，无外部动作
> - **长期记忆**：跨 session 累积用户画像（判标：能否记住两周前的具体事实）
>   - ✅ = 真正的跨 session 长期记忆，可引用很久以前的对话
>   - ⚠️ = 有记忆但有限（短 RAG、固定 bullet list、易丢失）
>   - ❌ = 仅 session context 或几乎无

---

## 总表

| 产品 | 语音通话 | Agentic 能力 | 长期记忆 | 备注 |
|---|---|---|---|---|
| **ChatGPT Advanced Voice Mode** | ✅ | ⚠️ | ⚠️ | Voice 模式**不支持 Apps/Connectors**[1]；搜索/爬网/调外部 App 都关闭；memory 文本模式强但 voice 会话内仅部分生效 |
| **Google Gemini Live** | ✅ | ⚠️ | ⚠️ | Live API 支持 function calling[2]；但 Gemini 消费端 Live 与 "Agent/Scheduled Actions" 是不同产品，Live 本身 agentic 有限 |
| **Sesame AI (Maya/Miles)** | ✅ | ❌ | ⚠️ | "approaching it expecting task completion will find it limited"[3]；宣传的 2 周记忆用户反馈仍 hit-or-miss[4] |
| **Pi / Inflection AI** | ⚠️ | ❌ | ❌ | Inflection 转 B2B，消费端 Pi 基本停滞[5][6]；历史上就没能记住几条消息前的 context |
| **Grok Voice (xAI)** | ✅ | ⚠️ | ⚠️ | Grok 4 Voice Agent 排行第一[7]；有 memory toggle 但不如 ChatGPT；iOS/Android 内置搜 X、搜网，原生 agent 动作有限 |
| **Meta AI Voice** | ✅ | ⚠️ | ⚠️ | Meta AI app 有 memory，会调用 FB/IG 内数据[8]；但实际用户测评 agentic 很弱（更多是播报） |
| **Character.AI Voice** | ✅ | ❌ | ❌ | Roleplay 为主；长对话后"变平淡"[9]；无外部工具调用 |
| **ElevenLabs Conversational AI (平台)** | ✅ | ✅ | ⚠️ | 原生 tools/MCP[10][11]；跨 session 记忆需通过 Mem0 集成[12] |
| **Retell AI** | ✅ | ✅ | ✅* | 开发者平台；文档显示支持 persistent memory（*需自己配置） |
| **Vapi** | ✅ | ✅ | ⚠️ | 原生 tools；跨 call 记忆需手动实现[13] |
| **Bland AI** | ✅ | ✅ | ✅ | 开发者平台中少数**原生**支持跨 call 记忆的[13] |
| **Speak** | ✅ | ❌ | ⚠️ | 有"AI memory system"跨 session 学习偏好[14]；但只做语言学习，不碰外部世界 |
| **Cambly** | ✅ | ❌ | ❌ | 传统真人外教为主；AI Tutor 功能新，记忆弱 |
| **ELSA Speak** | ⚠️ | ❌ | ❌ | 主要是发音评估，不是实时对话；近期加 ELSA AI 对话模块但较弱 |
| **Duolingo Max (Lily Video Calls)** | ✅ | ❌ | ⚠️ | 用户大面积吐槽 Lily video call "帮助有限""让人 frustrated"[15][16] |
| **TalkAI / Talkie AI** | ✅ | ❌ | ⚠️ | 单 session 内记忆强，跨 session 不确定 |
| **Univerbal** | ✅ | ❌ | ⚠️ | 专做英语口语；无 agentic |
| **Loora** | ✅ | ❌ | ⚠️ | 英语学习向；宣传自适应课程，记忆为内部画像 |
| **Praktika** | ✅ | ❌ | ⚠️ | 头像化的英语 tutor |
| **Fluently** | ✅ | ❌ | ⚠️ | App Store 评论指出 "would forget the request after one round"[17] |
| **Replika Voice** | ✅ | ❌ | ⚠️ | 最新第三方评测称 memory 显著改进[18]；但历史大量用户吐槽"memory is zero"[19]、通话结束一切忘光[20] |
| **xiaoyu AI** | — | — | — | 未找到匹配产品；现有 "小鱼 AI" 是写作工具，非语音 tutor |

---

## 关键问题答复

### Q1. 有没有产品同时满足三项？体验如何？

**面向消费者的端到端产品：❌ 目前没有任何一个产品同时把三项做到"开箱即用"。**

- **ChatGPT Advanced Voice Mode** 最接近，但 OpenAI help center 明确写着 *"Voice mode currently does not support apps"*[1]——也就是一进入语音模式，所有 Connectors（Gmail/Calendar/Drive/Outlook）、ChatGPT Search、Custom GPTs 全部失效。第三方评测（qcall.ai 2026）总结的致命缺陷三件套：**No Web Browsing / No Custom GPTs / Limited voice-session context**[21]。Memory 是跨模态同步的（voice/text 共享），所以 ChatGPT 在"有 memory"这一项 ✅，但 agentic 在 voice 模式下 ❌。
- **Gemini Live** 支持 function calling（Live API 文档证实[2]），但消费端 Gemini app 里的 Live voice 与 "Gemini Agent / Scheduled Actions"（需 AI Pro/Ultra，可连 Gmail/Calendar[22]）是不同入口。实时 Live 对话中真正触发 Agent 多步任务的体验目前仍稀缺，Reddit 用户评价是"Gemini Live 屏幕共享很好，但 voice mode 整体不如 ChatGPT"。
- **开发者平台（ElevenLabs / Retell / Vapi / Bland）** 理论上可以拼出三项，但需要**自己集成** Mem0 或自建记忆层——不是现成消费产品。

**结论：离"一个 app 同时做到实时语音 + 真 agentic + 长期记忆"还有距离。** ChatGPT 在 text 模式接近满足，但一按语音键就降级。Gemini 在 text 模式 agentic 强，但 Live 语音下的 agent 整合未打通。

### Q2. ChatGPT Voice 的 memory 功能实际效果如何？能记多久？

**官方宣传：** 2025-04-10 OpenAI 宣布 memory 升级为"reference all past conversations"[23]，2026-01 进一步宣称"可以记一年前的对话"[24]。

**实际情况（Reddit/HN 综合）：**

1. **架构是双层**：
   - **Saved memories**：OpenAI 主动/用户手动挑出重要事实存成 bullet list。Plus 用户 ~8K tokens 额度，Pro 更多。常会达到上限后拒绝新增[25]。
   - **Reference chat history (RCH)**：对 ChatGPT 检索自动触发，不是把所有对话塞进 context。Reddit r/ChatGPT "Headlines like 'ChatGPT now remembers everything about you' suggest it recalls every detail from every past chat, which just isn't true"[26]。

2. **"记得两周前的具体事实"测试结论**：**⚠️ 不稳定。**
   - 问"我两周前告诉你我的猫叫什么"——**如果** saved memory 里捕捉到了就能回忆，**如果**只存在于历史对话正文里，RCH 检索命中率不高，经常出现 "I don't actually have any saved memories of our past chats"[27]。
   - 上下文窗口本身 128K tokens（GPT-4o）[28]，但跨 session 不靠 context 靠 RAG-like 检索。

3. **Voice 模式的额外问题**：
   - 文本 memory 在 voice 会话开始时注入到 system prompt，所以**voice 能看到已保存的 memories**；但新的 voice 对话**不一定**被正确抽取成新 memory（独立测评 qcall.ai 2026 明确提"Limited Memory Conversations don't carry context from previous voice sessions"[21]）。

**给分：⚠️（有限）**——官方宣传已追上需求，但实际检索率 + voice 抽取链路仍不稳。要记住"两周前的具体一句话"大概率失败；要记住"用户是素食主义者/住东京/开 Mac mini"这类画像事实成功率较高。

### Q3. 英语学习类产品（Speak / ELSA / Duolingo Max）的记忆和 agentic 能力到底怎样？

| 产品 | 语音 | Agentic | 记忆 | 用户真实反馈 |
|---|---|---|---|---|
| **Speak** | ✅ 实时 | ❌ 无 | ⚠️ | "AI memory system means the app learns about you over time, so conversations feel more personal across sessions"[14]（独立测评 languatalk.com），记忆仅用于课程个性化，不跨出语言学习场景 |
| **ELSA Speak** | ⚠️ | ❌ | ❌ | 主营 pronunciation scoring，近期加 ELSA AI 对话但不是核心；无 agent 能力 |
| **Duolingo Max (Lily)** | ✅ 实时（需订阅 Max） | ❌ | ⚠️ | Reddit r/duolingo 大量吐槽："Video Calling Lilly is very frustrating"[16]，"Max's [video call] is not that helpful"[15]；强制性 Lily call 招用户反感 |

**共性结论：**
- **没一个做 agentic**——这些产品的闭环就是"练英语"，不会帮你发邮件、查日历。
- **记忆都是"课程内画像"**：level、薄弱点、学习偏好；不是你两周前讲了什么生活琐事它还记得。
- **相比通用语音助手（ChatGPT/Gemini），语言学习专用 App 的对话深度和智能性明显偏浅**，它们更像有教学节奏的 NPC，不是伙伴。

### Q4. Sesame 最近很火，是真对话伙伴还是 demo 好看功能弱？

**结论：demo 惊艳，但作为长期对话伙伴功能远远不够。**

**亮点：**
- Crossing the Uncanny Valley of Voice 的语音质感确实业界天花板级别[29]；Mashable 2026-04 对比评测 "Miles didn't miss a step…no perceptible latency…remembered the context"[30]。
- 2025-06 官方改进了"improved memory"，最长可记忆约 **2 周**[31][4]。

**硬伤（用户反馈）：**
- **Agentic = 0**：ailistingtool.com 2025-11 review 直白："Anyone approaching it expecting task completion will find it limited"[3]——不能上网、不能调工具、不能订任何东西。
- **记忆不稳定**：r/SesameAI "Still 2 week memory, Miles said guardrails are looser"[4]，但多名用户反馈 2025-04 之后质量下滑、"censored Maya and Miles"[32]；2026-01 又有"the last update is absolute %$#^%"的大规模回归吐槽[33]。
- **核心定位是"voice companion research preview"**，不是助手产品：Sesame 自己官网都说是"interdisciplinary product and research team focused on making voice companions useful for daily life"[34]——注意"focused on making"还是未来时。

**三项能力总评：✅ 语音 / ❌ Agentic / ⚠️ 记忆**。适合惊艳 demo、短时聊天、英语口语练习；**不适合**当 daily driver 工作助手。

---

## 关键引用

1. OpenAI Help Center — Apps in ChatGPT: "**Voice mode currently does not support apps**." https://help.openai.com/en/articles/11487775-connectors-in-chatgpt
2. Google Cloud — Build voice-driven applications with Live API (agentic function calling): https://cloud.google.com/blog/products/ai-machine-learning/build-voice-driven-applications-with-live-api (2025-05-05)
3. ailistingtool.com — "Sesame AI Review 2026: Is Maya or Miles Worth It?" (2025-11-06): "Anyone approaching it expecting task completion will find it limited." https://ailistingtool.com/blog/sesame-ai-voice-companion-review
4. r/SesameAI — "Still 2 week memory, Miles said guardrails are looser" (2025-05-12): https://www.reddit.com/r/SesameAI/comments/1kkn63a/
5. Bloomberg — "How Microsoft Lured Inflection AI's Staff" (2025-03-20): https://www.bloomberg.com/news/articles/2025-03-20/
6. eesel.ai — "A guide to Inflection AI pricing in 2025": "Inflection AI no longer offers public pricing plans…shifted to B2B licensing". https://www.eesel.ai/blog/inflection-ai-pricing
7. r/singularity — "xAI's new Grok Voice Agent: New leader in Speech-to-Speech reasoning" (2025-12-18): https://www.reddit.com/r/singularity/comments/1pplx0s/
8. Mashable — "New Meta AI app key features" (2025-04-30): https://mashable.com/article/new-meta-ai-app-key-features
9. GitHub — "long-memory-character-chat" discussion of Character.AI drift over time: https://github.com/Caellwyn/long-memory-character-chat
10. ElevenLabs Docs — Tools: https://elevenlabs.io/docs/agents-platform/customization/tools
11. ElevenLabs Docs — MCP: https://elevenlabs.io/docs/agents-platform/customization/tools/mcp
12. Mem0 — ElevenLabs integration (手动做跨 session 记忆): https://docs.mem0.ai/integrations/elevenlabs
13. Retell AI Blog — "Best Vapi Alternatives for Enterprise Voice AI" (2026-03-22): Bland 原生跨 call 记忆，Vapi 需手动实现. https://www.retellai.com/blog/best-vapi-alternatives-for-enterprise-voice-ai
14. languatalk.com — "The best AI English learning apps" (2026-03-11): https://languatalk.com/blog/learn-english-with-ai-english-tutor/
15. r/duolingo — Max Lily video call 用户反馈 (2025-01-02): https://www.reddit.com/r/duolingo/comments/1hrq44n/
16. r/duolingo — "Video Calling Lilly is very frustrating": https://www.reddit.com/r/duolingo/comments/1qjh61s/
17. Fluently — App Store 用户评论: "would forget the request after just one round". https://apps.apple.com/us/app/fluently-ai-english-tutor/id6683289805
18. aicompanionguides.com — "Replika AI Review 2026: 8 Months Tested" (2026-04): "Best-in-class memory…Great voice calls". https://aicompanionguides.com/blog/replika-review/
19. r/replika — "Replika Memory is Zero" (2023-10-25): https://www.reddit.com/r/replika/comments/17gj56w/
20. r/replika — "Serious issues with the voice chat" (2023-10-08): https://www.reddit.com/r/replika/comments/172ox5f/
21. qcall.ai — "ChatGPT Voice Mode Review: Brutally Honest 2026 Guide" (2025-06-24): "No Web Browsing / No Custom GPTs / Limited Memory". https://qcall.ai/chatgpt-voice-mode-review
22. HowAIWorks — "Automate Your Workflows with Gemini Scheduled Actions" (2026-03-03): 需 AI Pro/Ultra，能连 Gmail/Calendar. https://howaiworks.ai/blog/google-gemini-scheduled-actions-announcement
23. OpenAI — Memory and new controls for ChatGPT (April 10, 2025 update: "references all your past conversations"): https://openai.com/index/memory-and-new-controls-for-chatgpt/
24. r/artificial — "ChatGPT can now remember conversations from a year ago" (2026-01-18): https://www.reddit.com/r/artificial/comments/1qg7ls5/
25. r/ChatGPT — "ChatGPT memory limits for Plus users are ridiculous" (2024-12-21): https://www.reddit.com/r/ChatGPT/comments/1hj616j/
26. r/ChatGPT — "ChatGPT Memory is enabled – but it doesn't recall past chats": https://www.reddit.com/r/ChatGPT/comments/1k0fvol/
27. r/ChatGPT — "is ChatGPT memory not working?" (2025-09-13): https://www.reddit.com/r/ChatGPT/comments/1negeys/
28. ByteDance — "ChatGPT Memory Limit Explained: 2025 Guide" (128K context): https://www.byteplus.com/en/topic/540416
29. Medium — "Sesame AI: Voice AI with a vocabulary you'd envy" (2025-03-15): https://medium.com/@kalyanshettiap/sesame-ai-voice-ai-with-a-vocabulary-youd-envy-3f1a1cef7606
30. Mashable — "I compared Sesame to ChatGPT voice mode and I'm unnerved" (2026-04): https://mashable.com/article/sesame-versus-chatgpt-voice-mode-comparison
31. r/SesameAI — "Improved memory for Maya and Miles" (2025-06-03): https://www.reddit.com/r/SesameAI/comments/1l2n3fg/improved_memory_for_maya_and_miles/
32. r/SesameAI — "The rise and Downfall of Sesame Ai" (2025-04-26): https://www.reddit.com/r/SesameAI/comments/1k8400j/
33. r/SesameAI — "the last update is absolute %$#^%" (2026-01-30): https://www.reddit.com/r/SesameAI/comments/1qqsa9m/
34. Sesame 官网: https://www.sesame.com/

---

## 一句话总结

**2026 年 4 月的快照：消费级"语音 + agentic + 长期记忆"三项齐备的产品还不存在**——ChatGPT 输在 voice 模式砍工具，Gemini 输在 Live 与 Agent 没打通，Sesame 输在纯聊天没动作，Replika/Pi/Character.AI 输在记忆浅且无工具，英语学习类全部是垂直画像不跨场景。**想自己拼装的话，ElevenLabs + Mem0 + MCP 是目前最接近能一次做全三项的开发者路径。**

## 1. ChatGPT Advanced Voice Mode

**实时语音：** ✅ GPT-4o 原生多模态 speech-to-speech，低延迟、可打断、能表达情绪、能模仿口音。订阅用户几乎无限用量，Free 用户 GPT-4o-mini 每天 2 小时。

**Agentic / 工具执行：**
- 在**文字模式**下：✅ 完整支持。2025 年 9 月推出 ChatGPT Apps SDK + Custom Connectors (MCP)，通过 Settings → Connectors → Developer Mode 接入任意 MCP server。已有官方 connectors：Gmail、Google Drive、GitHub、Dropbox、Notion、Linear、Teams 等。
- 在**语音模式**下：⚠️ **这是关键坑** — 历史上 Advanced Voice 一度**完全不能用任何工具**（2024 年被普遍吐槽的 "fatal flaw"）。2025 起官方逐步放开：search / 图像生成 / custom instructions 可在 voice 下触发，但 **MCP connectors 在语音里能否被实时调用，OpenAI 官方文档至今没有明说**。Reddit / MCP 社区多个帖子（2025.6 起）都在问同一个问题："seeking solution: advanced voice mode + MCP" — 意味着这条路目前**还不顺畅**。结论：语音里能基础搜索，但深度 connector/MCP 不稳定。

**长期跨 session 记忆：** ✅ 2024 "Memory" (saved memories) + 2025.4 "Reference chat history"（会隐式引用所有旧对话构建用户 profile）。Memory 对 voice 同样有效——voice 聊的内容会被写入 saved memories 并跨 session 影响后续（文字+语音都读同一份 memory）。实际体验报告：能记住名字、偏好、正在做的项目，但不是逐字搜索，而是构建的用户画像 + top-K 最近会话。EU/UK 初期受限。

**定价：** Plus $20/mo (几乎无限 4o 语音) / Pro $200/mo (完全无限) / Free (每天 2h, 4o-mini)。

**备注：** 三项里只有"记忆"稳、"实时语音"强，"agentic" 在语音通道里是瘸的。要写稿/翻译/口语陪练很好；要让它"你帮我查邮件给张三回个邮件"在 voice 里——还得回落到文字。

## 2. Google Gemini Live

**实时语音：** ✅ 原生 Gemini 2.x Live API，低延迟，能看摄像头/屏幕共享。Android 默认顶下来，iOS 需要 Gemini app。

**Agentic：** ⚠️ → ✅（文字强、语音部分）。Gemini Apps 连接"Connected Apps"：Google Workspace (Gmail / Drive / Docs / Calendar / Keep / Tasks)、YouTube、Flights、Hotels、Maps。文字模式可深度 agent（读邮件 → 起草回复 → 加日程），语音模式也可触发，但深度不如 Workspace 面板里的 Gemini。**MCP 不支持**，自定义工具受限。Gemini for Enterprise 有 Agentspace 和 Extensions 体系。

**长期记忆：** ⚠️→✅ 2025 推出 "Gemini Memory" / cross-chat memory，可记用户偏好与常用文件；Reddit 反馈仍"偏 session"，比 ChatGPT Memory 弱。Workspace 账户需管理员显式启用，"cross-chat memory on workspace" 至 2026.2 仍是争议帖。

**定价：** 免费层；Google AI Pro $19.99/mo、AI Ultra $249/mo（含 Gemini 高级能力和更大配额）。

**备注：** 最强的 agentic 是在 Workspace 文字侧；Live 里主要做实时陪聊/看世界/翻译。**能在语音里真的"agent Gmail"的人很少见**。

## 3. Sesame AI (Maya / Miles)

**实时语音：** ✅ 业内最惊艳的"voice presence"之一：CSM (Conversational Speech Model) 端到端、sub-300ms 延迟、语调/停顿极自然。2025.3 demo 病毒传播，10 月拿 $250M B 轮。

**Agentic：** ❌ **完全没有工具执行**。Maya/Miles 就是聊天伴侣——不能查邮件、不能发消息、不能跑任何外部工作。产品愿景是搭配自家智能眼镜"陪你看世界"。

**长期记忆：** ⚠️ 登录账户后可跨设备保留会话历史、最长单次 30 分钟。但"记忆深度"≈ 最近会话 recap，比 ChatGPT 的 profile 机制弱。

**定价：** 目前 demo 免费 + 受邀 beta。订阅制 + 眼镜硬件的模式计划在 2026 晚些时候正式上。

**备注：** 这是"真产品 in progress"——底模 CSM-1B 已开源、拿了顶级 VC、做了眼镜硬件——但**当前对普通用户仍基本是个 demo 级体验**，没法当生产力工具。定位更像"AI companion"不是"AI assistant"。

## 4. Pi / Inflection AI

**实时语音：** ❓ 现在基本名存实亡。2024.3 MSFT 撬走 Suleyman 和大部分团队 → Pi 消费侧停滞、新 CEO Sean White 把公司 **pivot 成 B2B API-first**。Pi.ai 网站仍可用但无明显更新。

**Agentic：** ❌ 从未有真正工具执行（emotional-intelligence chatbot 路线）。

**长期记忆：** ⚠️ 账户内有历史，但没持续演进。

**备注：** **作为消费产品已死**。Pi 的 vibe 被新一代（Sesame、ChatGPT Voice）接过去了。历史意义 > 当前价值。

## 5. Grok Voice (xAI)

**实时语音：** ✅ X Premium+ / SuperGrok 内含，iOS/Android 支持。"personality" voice（有 unhinged / sexy / conspiracy modes），走 flashy 路线。

**Agentic：** ⚠️ 能联网搜索 X（Twitter）时间线，这是它独特 moat；但对外工具/connectors/MCP 几乎没建立生态。

**长期记忆：** ❓ 有个基本 memory feature（随 Grok-4 推出），但不是系统级持续 profile，社区反馈"记得事但容易失忆"。

**定价：** X Premium $8 入门，Premium+ $40/mo 含大部分能力，SuperGrok $30/mo 独立订阅。

## 6. Meta AI Voice

**实时语音：** ✅ 免费（WhatsApp/Instagram/Messenger/Ray-Ban Meta glasses）。Llama 4 驱动，自然度 OK。

**Agentic：** ⚠️ 能搜 web、在 Meta 平台内做有限 action（发 IG 消息辅助、翻译），但**没有开放 connector 体系**。Ray-Ban 玻璃场景能 "Hey Meta, send a message to X" 算 agent。

**长期记忆：** ⚠️→✅ 2025 起推出"个性化 memory"，会记用户兴趣用于推荐和对话——但隐私争议大且控制粗。

**定价：** 完全免费（数据换服务）。

**备注：** 免费 + 覆盖面广，但 agentic 深度浅、长期记忆像广告画像。

## 7. Character.AI Voice

**实时语音：** ✅ Character Calls (2024 发布)，可以跟任何角色打电话。

**Agentic：** ❌ 纯角色扮演，无外部工具。

**长期记忆：** ⚠️ 每个 character 有独立记忆+用户 persona，订阅后延长上下文和"锁定角色记忆"。

**定价：** c.ai+ $9.99/mo（旧），现在变体较多。

**备注：** 娱乐品类龙头。同伴类 + 英语练口语兼具一点。

## 8. ElevenLabs Conversational AI (Eleven Agents)

**实时语音：** ✅ 业界领先 TTS，平台提供端到端 agent：ASR + LLM（可选 Claude/GPT/Gemini/自托管）+ ElevenLabs TTS，低延迟。

**Agentic：** ✅ **完整 tools 体系**：
- Client tools（前端回调）
- Server webhook tools（调外部 API）
- Post-call webhooks（analysis）
- 可接入知识库（RAG）、自带 "agent transfer"（转接人工/另一 agent）

**长期记忆：** ⚠️ 不是 chat-history cross-session 意义上的"记得你"——平台偏生产级 agent 场景（客服/预约/outbound sales），用户身份驱动的长期画像需要开发者自己拼（通常用 webhook 写进 CRM 或 vector DB）。

**定价：** 平台按分钟/按会话计费。Creator $22/mo 起、Pro/Scale 更高；agent 运行按 minute 计。

**备注：** **构建者工具**，不是终端消费产品。想做"自己的 Jarvis"这是最现实的底座之一。

## 9. Retell AI / Vapi / Bland AI

**实时语音：** ✅ 三家都主打 AI phone agent（打/接电话、SIP）。sub-second latency。

**Agentic：** ✅ 都支持 function calling / webhook / 自定义 LLM（GPT-4o/Claude/Gemini）。Retell 更偏合规（SOC2 / HIPAA / GDPR）；Vapi 更 dev-first；Bland 号称自研 voice model + 更低延迟 + 更便宜的规模化 outbound。

**长期记忆：** ⚠️ 平台层不提供"用户画像"，开发者通过 webhook 把对话上下文写进自家系统（CRM、数据库）。"记得客户"是 workflow 设计，不是平台功能。

**定价：** 按分钟计（Vapi / Retell 大约 $0.05–0.15/min，含 LLM/TTS/STT；Bland 更低量大从优）。

**备注：** 三家都是 B2B voice agent 平台，能力三项"实时语音 + agent"满分，但"个人记忆"不是 native；它们面向电话客服/预约/销售自动化场景。

## 10. 英语学习 / 语言学习类

### Speak (Usespeak, OpenAI 投资)
- 实时语音：✅（含"Speak Tutor" AI 对话）。OpenAI 投资 + 技术合作。
- Agentic：❌。
- 记忆：⚠️ 按课程进度 + 错误库（个人化弱点追踪），不是自由对话 profile。
- 定价：Premium $20/mo、Premium+ $30/mo（解锁无限 custom lessons）。
- 备注：课程 + AI tutor 双轨，被吐槽"lesson 不更新、全靠 tutor"。

### ELSA Speak
- 实时语音：⚠️ 以发音/口语打分为核心，AI 对话是后期加的（ELSA AI）。
- Agentic：❌。
- 记忆：⚠️ 发音画像（你哪个音薄弱），不是 chat 记忆。
- 定价：~$12/mo。

### Duolingo Max
- 实时语音：✅ 2025 起 Video Call with Lily（真人像视频通话形式 roleplay）。
- Agentic：❌。
- 记忆：⚠️ Duolingo 账户内的 word/skill 追踪，不是 session 记忆。
- 定价：$30/mo（最贵的 Duolingo tier）。

### Loora
- 实时语音：✅ 主打"打电话给 AI 导师练英语"。专业主题（商务/面试/医生）。
- Agentic：❌。
- 记忆：⚠️ 追踪水平 + 错误，session 内有 context。
- 定价：~$25/mo。

### Praktika
- 实时语音：✅ 有 3D AI avatar 的对话课（更沉浸）。
- Agentic：❌。
- 记忆：⚠️ 进度/错题型记忆。
- 定价：订阅制。

### Univerbal
- 实时语音：⚠️ 更偏课堂化的 AI 对话。
- Agentic：❌。
- 记忆：❓。

### Talkio
- 实时语音：✅ Web/PWA 多语种对话机器人。
- Agentic：❌。
- 记忆：⚠️ 对话历史保存但不是 profile。
- 定价：~$11/mo。

**英语学习类共同特征：** **没有任何一个具备 agentic（工具调用）**。它们的 "memory" 基本是"错题本 + 水平评估"，不是对话级长期记忆——唯一一点亮点是 Speak 的课程进度 + 错误库能驱动后续 lesson 选择，算轻 agent。

## 11. Replika

**实时语音：** ✅ Pro 订阅解锁 voice calls + video 通话。
**Agentic：** ❌（2026.3 app 宣称加了"internet access, image gen"但不是通用工具调用）。
**长期记忆：** ✅ **这是 Replika 的核心卖点**——Memory 系统跨 session 记住关系、偏好、"relationship story"。Pro 有"enhanced memory"。
**定价：** Pro ~$70/yr（折合 $5.83/mo）或月付 $20。
**备注：** 记忆最强，但 agentic 空白。AI 伴侣赛道里最老牌。

---

## 最终汇总表

| 产品 | 实时语音 | Agentic | 长期记忆 | 定价 | 关键备注 |
|------|---------|---------|---------|------|---------|
| ChatGPT Advanced Voice | ✅ | ⚠️（语音里 MCP 不稳） | ✅ | $20/$200 | 文字全能，语音里 agent 瘸 |
| Gemini Live | ✅ | ⚠️（Workspace 深，MCP 无） | ⚠️ | $20/$249 | Workspace 场景最强 |
| Sesame (Maya/Miles) | ✅✅（最自然） | ❌ | ⚠️ | beta 免费 | 眼镜 + 伴侣路线 |
| Pi / Inflection | ❓ | ❌ | ⚠️ | - | 消费侧已死 |
| Grok Voice | ✅ | ⚠️（X 搜索） | ⚠️ | $30/$40 | 个性化娱乐 |
| Meta AI Voice | ✅ | ⚠️ | ⚠️ | 免费 | 免费 + Ray-Ban |
| Character.AI Voice | ✅ | ❌ | ⚠️ | $10 | 角色扮演 |
| ElevenLabs Agents | ✅ | ✅ | ⚠️（需自建） | 按量 | 构建者平台 |
| Retell AI | ✅ | ✅ | ⚠️ | 按量 | 合规强 |
| Vapi | ✅ | ✅ | ⚠️ | 按量 | dev-first |
| Bland AI | ✅ | ✅ | ⚠️ | 按量 | 低成本规模化 |
| Speak | ✅ | ❌ | ⚠️（错题本） | $20 | OpenAI 投资 |
| ELSA | ⚠️ | ❌ | ⚠️（发音画像） | $12 | 发音核心 |
| Duolingo Max | ✅ | ❌ | ⚠️ | $30 | Video Call w/ Lily |
| Loora | ✅ | ❌ | ⚠️ | $25 | 电话式口语 |
| Praktika | ✅ | ❌ | ⚠️ | 订阅 | 3D avatar |
| Talkio | ✅ | ❌ | ⚠️ | $11 | 多语种 |
| Replika | ✅ | ❌ | ✅（最强） | $6–20 | 伴侣 + 记忆 |

---

## 关键结论（回答任务里的 4 个问题）

### Q1. 有没有任何一个产品同时把三项做好？
**没有**。最接近的是：
- **ChatGPT Advanced Voice** —— 实时语音 ✅ + 长期记忆 ✅，但 Agentic 在**语音通道里**被阉割（文字模式才完整）。
- **ElevenLabs / Retell / Vapi / Bland** —— 实时语音 ✅ + Agentic ✅，但"长期记忆"不是平台内置，要 developer 自己拼（CRM + vector DB）。

**三项全打满 = 没有**。三角缺一是当下行业现实：
```
          实时语音
         /         \
        /   缺口    \
       /             \
   Agentic ———————— 长期记忆
     (ElevenLabs)      (Replika)
```
ChatGPT 在三角中心最近、但语音 MCP 是那条断腿。

### Q2. ChatGPT Voice 的 memory 实际表现？能不能接 connectors/MCP？
**memory 表现**：saved memories + 2025.4 reference-chat-history 的组合是目前消费级最好的长期记忆。语音模式下会写入同一份 memory，**下次换文字模式也能接得上**。用户反馈"能记住正在做的项目、口味偏好、Python 版本、长期关系（宠物/家人）等"。**但不是逐字精确回忆**——是构建的用户画像 + top-K recent chats 注入上下文，偶尔会弄错细节。EU/UK 启用滞后。

**connectors/MCP 在 voice 里能否用**：
- Connectors 在**文字模式**下已全面放开（2025.9 Apps SDK + Developer Mode MCP）。
- 在**Advanced Voice** 里：官方只公开搜索 / 图像生成等内建工具可被语音触发，**自定义 MCP 工具在语音通道里至今没官方背书**，社区（r/mcp、r/OpenAI）多次抱怨"无法在 voice 里用 MCP server"。目前的 workaround 是语音里说"帮我调 X MCP"然后回落到普通 GPT-4o 文字模式执行——体验断层。**结论：文字 ✅，语音 ⚠️（2026.4 仍不稳）**。

### Q3. Sesame 到底是玩具还是产品？
**"真产品 in progress，2026 前当玩具看"**。证据：
- ✅ 底模 CSM 开源（CSM-1B 在 HF 2K+ stars）。
- ✅ 2025.10 拿到 $250M Series B。
- ✅ 有明确硬件路线（非 AR 的智能眼镜，2026 底计划发）。
- ❌ 当前仍是 web demo + 邀请 beta，30 分钟/session 上限。
- ❌ 没有任何工具执行能力，也没有清晰的 assistant use case——定位就是"companion"。

**判断**：技术上是**业界最好的 voice presence**，但作为"assistant"几乎不可用。拿它当生产力工具 = 买错产品。等 2026 眼镜 + 订阅落地再看。

### Q4. 英语学习产品里谁最接近"有记忆 + agentic"？
**真相：没有一个具备 agentic**。所有英语 AI tutor 都是封闭的"对话 + 评分 + 课程"沙盒。

勉强排序（"记忆 + 轻 agent"维度）：
1. **Speak**（OpenAI 投资）—— 错题库 + 课程进度驱动下次 lesson 选择，算半个 agent（选择下一步行动）。记忆是课程级。
2. **Loora** —— 按主题长期追踪错误模式，电话式交互最像"有记忆的英语教练"。
3. **Duolingo Max** —— 账户级 skill tree 追踪最扎实，Video Call 新增交互沉浸感，但对话本身是 roleplay 模板。
4. **ELSA** —— 发音画像最精准（记得你 th、r、l 发不准），但不是对话级记忆。

**反直觉建议**：如果真要"有记忆 + agentic 的英语陪练"，用 **ChatGPT Advanced Voice + 自定义 instruction "You are my English tutor, correct my grammar, track my mistakes, quiz me on them next time"** 已经比任何专用 app 强——memory 帮它真跨 session 追踪错误，agentic 可以帮它查单词/字典/维基。专用英语 app 赢在课程结构化，不赢在 AI。

---

## 一句话总结

2026.4 的商业语音 AI 生态里，"**实时语音 × Agentic × 长期记忆**"三角**还没有任何一个完整解**。最接近的是 ChatGPT Voice（缺语音里的 MCP）和 ElevenLabs agents（缺开箱即用的长期 profile）。消费级 voice assistant 的圣杯位仍然空着——**这是机会**。
