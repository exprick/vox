# Teacher — 会说话的语言学习 Agent

> **一句话定位：** 会说话、会记忆、会写代码的语言学习 Agent。先做英文，未来扩日文/中文。

## 🎯 第一性需求

Teacher 不是一个“语音英语陪练 App”。Teacher 是一个 **spoken interface to a persistent, coding-capable learning agent**。

语音只是自然入口，产品本体是一个能长期理解用户、主动规划学习、调用工具、生成教学软件、更新教学策略的 Agent。

任何需求都必须围绕这个判断设计：

1. **它必须是 Agent，而不是被写死的程序** — 能理解目标、读取记忆、规划练习、执行动作、复盘结果。
2. **它必须有长期教学记忆** — 记住用户的真实任务、反复错误、待复习表达、学习偏好和历史表现。
3. **它必须能写代码和生成 artifact** — 能按需创建小测验、网页练习器、roleplay 控制台、复盘 dashboard，而不是只在固定 UI 里聊天。
4. **它必须能把学习闭环写回系统** — 每次练习都应更新记忆，并影响下一次教学。

详见 [`docs/first-principles.md`](./docs/first-principles.md)。

## 🎯 核心假设

2026.4 的市场上，AI 语言学习产品已经很多，单纯“语音陪练”不是稀缺能力。真正仍稀缺的是：

1. **Voice-first 交互**（用户可以自然开口）
2. **长期教学记忆**（错误、词汇、目标、偏好、历史练习结果）
3. **Agentic 执行能力**（能调工具、读外部上下文、安排复习）
4. **Coding-capable teaching runtime**（能为了教学现场写代码、生成网页和练习器）

Teacher 的机会不在于“又做一个语音对话产品”，而在于把 coding agent 的创造能力带入语言学习。

详见 [`research/00-summary.md`](./research/00-summary.md)。  
审计补充：[`research/04-audit.md`](./research/04-audit.md) 复核了原调研中偏绝对的判断，尤其是 Gemini Live、Langua、Duolingo Video Call 等更新后的竞品风险。

## 🎯 用户定位

**B2–C1 的"沉默型高阶学习者"** — 能读能写但一开口就卡壳。
- Duolingo 垄断 A1–A2
- Speak/Loora/Duolingo Max 都在 B1 挤
- B2+ 被行业集体放弃（Reddit 共识："even at highest level it's too easy"）

Teacher 默认用 C1 风格说话 + 偷偷估 CEFR，用户说"太难"才降。

## 🏗 技术栈（v0 假设）

```
Agent Runtime             (规划 + 工具 + 代码执行 + artifact 生成)
  ├─ Voice: LiveKit / Pipecat / OpenAI Realtime
  ├─ Memory: Teacher-owned schema + Letta / mem0 / Zep backend
  ├─ Coding: sandboxed file/code runtime + browser preview
  ├─ Tools: calendar / reminders / Anki / transcript import
  └─ UI: stable shell + generated teaching artifacts
```

原语音栈候选：

```
LiveKit Agents            (语音编排 + WebRTC/SIP)
  ├─ STT:  Deepgram       (口音宽容度最好)
  ├─ LLM:  gpt-4o-mini    + @function_tool
  │        (或 Claude Haiku)
  ├─ TTS:  ElevenLabs     (英语音色最自然)
  ├─ VAD:  Silero
  └─ Memory: Letta server (跨 session 持久化)
```

候选 plan B：Pipecat + mem0（管道式更显式，教学节奏好控制）。

端到端语音模型（Moshi/Qwen-Omni）暂不考虑 — 除 Step-Audio 2 外都不能 function call。

## 💎 差异化三板斧

### 1. Coding-capable teaching Agent（第一差异化）

Teacher 能为了教学现场生成软件，而不是只调用预设功能：

- `quiz.generate_page(error_fossils)` — 根据常犯错生成小测验网页
- `drill.build_speaking_timer(goal)` — 生成演讲/面试练习器
- `ui.revise_artifact(feedback)` — 用户说“太难/太简单/换题型”，Agent 直接改界面
- `report.generate_dashboard(session_results)` — 生成学习复盘和趋势图

如果 OpenClaw/Codex 能说话并长期记住你的学习状态，这就是 Teacher 要接近的形态。

### 2. 语言学习定制的记忆图谱（核心护城河）

五层结构化记忆，每次对话前由 "memory composer" 挑关键项注入 system prompt：

| 层 | 内容 | 用途 |
|----|------|------|
| `user_profile` | L1 / CEFR 估计 / 目标（IELTS 7？商务？）/ 兴趣 / 日程 | 决定话题 + 难度基线 |
| `vocab_srs` | 生词 last-seen / due-date / success-rate | 下次对话自然带出 5-10 个 due 的词 |
| `error_fossils` | 反复犯的错（"interested about music" × 4 次）+ 计数 | 满 3 次从 recast 升级到 explicit |
| `session_summaries` | 每次会话 3-5 条 bullet | 下次开头注入 |
| `cefr_estimate` | speaking / listening 分别滚动评估 | 不让用户考试，AI 偷偷估 |

ChatGPT 的通用 memory 做不出这种结构感。

### 3. Agentic 外挂（至少做 3 个）

- `vocab.export_to_anki(words)` — 一键把今日生词推 Anki
- `calendar.read_next_week()` — "你周三有面试，今天练英文面试"
- `reminder.set(time, phrase)` — "明天 10 点复习这 5 个词"
- 加分：`podcast.pull_transcript(url)` — 把你听的播客做教材

### 4. 产品形态（反直觉）

- **电话通话隐喻**，不是聊天窗 — 打开 app 点一下 3 秒内开始说话
- **Voice-first，不是 voice-only** — 意图表达优先语音，复杂练习/复盘/artifact 可以显示在界面上
- **无 4 分钟硬切** — 想说多久说多久（Duolingo Max 被骂最狠的点）
- **AI 无条件耐心 + 不带评判** — Reddit 用户最感恩的单一特征

## 📐 教学法铁律（论文背书）

- 用户发言时间 ≥ 80%，AI 别抢话（Output Hypothesis）
- 小错 recast 自然接（"Oh, so you *went* yesterday?"）
- 反复错 ≥3 次升级到 explicit（"Quick note: 'interested **in**' not **about**"）
- SRS 隐形化 — 生词编织进对话，不做成 Anki 卡片

## 🗓 MVP 路径（2-3 周）

- **W1:** 跑通 voice -> agent loop，不只语音聊天；Agent 能创建一个本地 quiz artifact
- **W2:** 接最小教学记忆（`user_profile` + `error_fossils` + `vocab_srs`）并让 artifact 结果写回记忆
- **W3:** 接 3 个 tool（calendar / Anki / reminder）+ 让下一次语音会话自然引用上次练习结果

## 📂 仓库结构

```
teacher/
├── PROJECT.md           ← 你现在看的
├── docs/                ← 产品与设计文档
│   ├── first-principles.md ← 第一性需求：会说话、会记忆、会写代码的学习 Agent
│   ├── memory-schema.md ← 五层记忆数据模型详细定义（TODO）
│   ├── tools.md         ← agentic 工具清单 + API 合约（TODO）
│   └── pedagogy.md      ← 教学策略实现细节（TODO）
├── research/            ← 市场调研（2026-04-23）
│   ├── 00-summary.md    ← 汇总（先看这个）
│   ├── 01-commercial.md ← 22 款商业产品深度分析
│   ├── 02-opensource.md ← 24+ 开源项目 + 架构代码
│   ├── 03-english-learning.md ← 18 款学习 App + 痛点 + 教学法
│   └── 04-audit.md      ← 对原调研的怀疑式复核与定位修正
└── src/                 ← 代码（TODO）
```

## ✅ 待办

- [x] 明确第一性需求：Teacher 是会说话、会记忆、会写代码的学习 Agent
- [ ] 细化五层记忆的数据 schema → `docs/memory-schema.md`
- [ ] 定义 MVP 的 3 个 agentic 工具接口 → `docs/tools.md`
- [ ] 定义 coding-capable teaching runtime：artifact 生成、预览、修改、结果写回
- [ ] 跑通 LiveKit + Letta 的 Hello World
- [ ] 决定 plan A (LiveKit+Letta) vs plan B (Pipecat+mem0) 的取舍 — 需要实际各跑一次
- [ ] 用户调研：找 1-2 个真实 B2+ 用户访谈需求

## 🔗 相关项目

- `/Users/lobster/dev/voicecall/` — 另一个项目（AI 电话订餐 MVP，独立方向），共用了 OpenAI Realtime / Twilio 经验
