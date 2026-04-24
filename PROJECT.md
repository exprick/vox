# Teacher — AI 语音英语陪练 Agent

> **一句话定位：** 带长期记忆、能 agentic 行动的语音英语陪练，先做英文，未来扩日文/中文。

## 🎯 核心假设

2026.4 的市场上，没有任何一款产品同时做好这三项：
1. **实时语音通话**（低延迟全双工）
2. **Agentic 执行能力**（真能调外部工具，不只是聊天）
3. **跨 session 长期记忆**（记住你两周前的错误、偏好、目标）

ChatGPT 输在 voice 模式砍工具，Sesame 输在零执行，英语学习类 App 全员输在"套壳 ChatGPT + 无 agentic"。Teacher 的机会就在这个三角缺口。

详见 [`research/00-summary.md`](./research/00-summary.md)。

## 🎯 用户定位

**B2–C1 的"沉默型高阶学习者"** — 能读能写但一开口就卡壳。
- Duolingo 垄断 A1–A2
- Speak/Loora/Duolingo Max 都在 B1 挤
- B2+ 被行业集体放弃（Reddit 共识："even at highest level it's too easy"）

Teacher 默认用 C1 风格说话 + 偷偷估 CEFR，用户说"太难"才降。

## 🏗 技术栈（v0）

```
LiveKit Agents            (编排 + WebRTC/SIP)
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

### 1. 语言学习定制的记忆图谱（核心护城河）

五层结构化记忆，每次对话前由 "memory composer" 挑关键项注入 system prompt：

| 层 | 内容 | 用途 |
|----|------|------|
| `user_profile` | L1 / CEFR 估计 / 目标（IELTS 7？商务？）/ 兴趣 / 日程 | 决定话题 + 难度基线 |
| `vocab_srs` | 生词 last-seen / due-date / success-rate | 下次对话自然带出 5-10 个 due 的词 |
| `error_fossils` | 反复犯的错（"interested about music" × 4 次）+ 计数 | 满 3 次从 recast 升级到 explicit |
| `session_summaries` | 每次会话 3-5 条 bullet | 下次开头注入 |
| `cefr_estimate` | speaking / listening 分别滚动评估 | 不让用户考试，AI 偷偷估 |

ChatGPT 的通用 memory 做不出这种结构感。

### 2. Agentic 外挂（至少做 3 个）

- `vocab.export_to_anki(words)` — 一键把今日生词推 Anki
- `calendar.read_next_week()` — "你周三有面试，今天练英文面试"
- `reminder.set(time, phrase)` — "明天 10 点复习这 5 个词"
- 加分：`podcast.pull_transcript(url)` — 把你听的播客做教材

### 3. 产品形态（反直觉）

- **电话通话隐喻**，不是聊天窗 — 打开 app 点一下 3 秒内开始说话
- **禁止打字输入**，包括设置/测级/复习，全部语音
- **无 4 分钟硬切** — 想说多久说多久（Duolingo Max 被骂最狠的点）
- **AI 无条件耐心 + 不带评判** — Reddit 用户最感恩的单一特征

## 📐 教学法铁律（论文背书）

- 用户发言时间 ≥ 80%，AI 别抢话（Output Hypothesis）
- 小错 recast 自然接（"Oh, so you *went* yesterday?"）
- 反复错 ≥3 次升级到 explicit（"Quick note: 'interested **in**' not **about**"）
- SRS 隐形化 — 生词编织进对话，不做成 Anki 卡片

## 🗓 MVP 路径（2-3 周）

- **W1:** LiveKit + Deepgram + gpt-4o-mini + ElevenLabs 能通话即可
- **W2:** 接 Letta 做记忆（先上 `user_profile` + `session_summaries` + `error_fossils`）+ 3 个 tool（anki / calendar / reminder）
- **W3:** recast/explicit 切换逻辑 + 隐形 CEFR 估算 + 真人跑 5-10 session 验收

## 📂 仓库结构

```
teacher/
├── PROJECT.md           ← 你现在看的
├── research/            ← 市场调研（2026-04-23）
│   ├── 00-summary.md    ← 汇总（先看这个）
│   ├── 01-commercial.md ← 22 款商业产品深度分析
│   ├── 02-opensource.md ← 24+ 开源项目 + 架构代码
│   └── 03-english-learning.md ← 18 款学习 App + 痛点 + 教学法
├── docs/                ← 设计文档（TODO）
│   ├── memory-schema.md ← 五层记忆数据模型详细定义
│   ├── tools.md         ← agentic 工具清单 + API 合约
│   └── pedagogy.md      ← 教学策略实现细节
└── src/                 ← 代码（TODO）
```

## ✅ 待办

- [ ] 细化五层记忆的数据 schema → `docs/memory-schema.md`
- [ ] 定义 MVP 的 3 个 agentic 工具接口 → `docs/tools.md`
- [ ] 跑通 LiveKit + Letta 的 Hello World
- [ ] 决定 plan A (LiveKit+Letta) vs plan B (Pipecat+mem0) 的取舍 — 需要实际各跑一次
- [ ] 用户调研：找 1-2 个真实 B2+ 用户访谈需求

## 🔗 相关项目

- `/Users/lobster/dev/voicecall/` — 另一个项目（AI 电话订餐 MVP，独立方向），共用了 OpenAI Realtime / Twilio 经验
