# Voice Agent 市场调研汇总（2026-04-23）

> 基于 `01-commercial.md`（396 行）+ `02-opensource.md`（800 行）+ `03-english-learning.md`（269 行）三份独立深度调研
> 目标能力三角：**实时语音 × Agentic 工具执行 × 跨 session 长期记忆**

## 一句话结论

**2026 年 4 月，消费端没有任何一款产品把三项同时做好；专做英语学习的产品里更是零一。这是一个清晰可见的产品空位。** 要自己做，骨架用 LiveKit Agents + Letta（或 Pipecat + mem0），两周内能出 MVP demo，真正的护城河是**为语言学习定制的记忆图谱**。

---

## 一、市场真相（商业产品）

### 三项齐备的产品 = 0

| 产品 | 语音 | Agentic | 记忆 | 关键卡点 |
|------|------|---------|------|----------|
| ChatGPT Advanced Voice | ✅ | ❌ | ⚠️ | **Voice mode 明确不支持 Apps/Connectors/MCP** — OpenAI help center 原话 |
| Gemini Live | ✅ | ⚠️ | ⚠️ | Live 能 function call，但消费端 Live 和 Gemini Agent 是两个入口，没打通 |
| Sesame (Maya/Miles) | ✅✨ | ❌ | ⚠️ | 语音质感业界天花板，但零工具执行，2 周记忆时好时坏，产品自己定位是 "voice companion"，不是 assistant |
| ElevenLabs/Retell/Vapi/Bland | ✅ | ✅ | ⚠️ | 开发者平台，消费端没有，记忆要自己接 Mem0 |
| Speak / ELSA / Duolingo Max / Loora | ✅ | ❌ | ⚠️ | 英语学习全员：**无一具备 agentic**，记忆只限于"学习画像" |

### 三个反直觉发现

1. **ChatGPT Voice 一按语音键，MCP 就罢工** — 这是所有巨头产品的共性缺陷
2. **Sesame 不是产品，是研究 preview** — 底模 CSM 开源、拿 $250M B 轮、做硬件眼镜，但当前 demo 性质
3. **英语学习圈最离谱的共识** — 大量独立测评直接说 *"不如用 ChatGPT Advanced Voice + 英语导师 custom instruction"*，因为 ChatGPT 的 memory 反而最像真跨 session

---

## 二、用户真实痛点（Reddit 爬出来，按频次排序）

1. 🔴 **"我在给 ChatGPT 套壳付钱"** — 最高频吐槽，TalkPal、Loora、大多数语言学习 App 都中招
2. 🔴 **B2+ 高级用户天花板太低** — 所有 App 都被喷"太简单、太表层"，advanced learner 没活路
3. 🔴 **每次都要重新介绍自己** — 没一个能记住你的水平、你的错题、你的目标
4. 🔴 **强付费墙 + 暗黑模式** — 流失率高，口碑差
5. 🟡 **对话感觉"被剪辑"** — Duolingo Max 4 分钟硬切、Lily 不让你说完
6. 🟡 **纠错时机烂** — 纠错要么太晚（事后弹窗）、要么太频繁（打断对话节奏）
7. 🟡 **不能接我的生活** — 不能把今天的生词推 Anki、不知道我明天有个面试、不会用我听的播客作教材

最后一条（**不能接生活**）= **agentic 缺口**，是这次所有调研最大的未被满足需求。

---

## 三、开源栈现状（可以自己拼）

### 框架：Pipecat vs LiveKit Agents（并列第一）

| 维度 | Pipecat (11.5k★) | LiveKit Agents (10.1k★) |
|------|------------------|-------------------------|
| 风格 | 管道式（Processor 链） | 插件式（AgentSession） |
| 语音传输 | Daily/WebRTC/WS/SIP | WebRTC + SIP + 电话 |
| 记忆集成 | 官方 **`Mem0MemoryService`** | 官方 **Letta plugin + `ZepUserAgent`** |
| 工具调用 | function tools + pipecat-flows | `@function_tool` 装饰器 + MCP |
| 现成 demo | `examples/rag/rag-mem0.py` | `letta-ai/letta-voice` 完整样板 |
| 社区案例 | 多（含 studypal 学习类） | 更多（104 个 runnable examples） |

**两个都选得起，但各有偏好方向：**
- 要"聊天里自然累积记忆" → **LiveKit + Letta**（agent 对象自带记忆能力，最省事）
- 要"灵活换组件 + 把教学流程当状态机设计" → **Pipecat + mem0**（管道更显式，教学节奏好控制）

### 端到端语音模型：基本不能做工具调用

| 模型 | 工具调用 | 结论 |
|------|----------|------|
| Moshi | ❌ | 架构耦合，社区 issue 久无进展 |
| Qwen2.5-Omni | 🟡 | 需通过 Qwen-Agent 中转，无官方 cookbook |
| GLM-4-Voice / LLaMA-Omni / Mini-Omni | ❌ | 多数停更 |
| **Step-Audio 2** | 🟢 | **唯一官方支持 Tool Calling 的 E2E 模型**，有 StepEval-Audio-Toolcall 基准 |

→ **结论：E2E 路线目前对 agentic 用例不成熟，STT+LLM+TTS 三段式暂时更可靠。**

### 记忆系统 TOP 3

- **mem0 (53.9k★)** — 最火、API 最简单、Pipecat 官方原生
- **Letta (22.2k★)** — agent 对象自带记忆，LiveKit 有官方 `letta-voice` demo
- **Zep (4.5k★)** — 知识图谱式，LiveKit 有 `ZepUserAgent`

---

## 四、给 Rick 的产品设计建议

### 技术栈（推荐）

```
LiveKit Agents（编排 + WebRTC/SIP）
  ├─ STT: Deepgram（英语学习场景口音宽容度最好）
  ├─ LLM: OpenAI gpt-4o-mini 或 Claude Haiku（便宜、快、够用）
  │        + @function_tool 挂外部能力
  ├─ TTS: ElevenLabs（自然度天花板，英语音色选择丰富）
  │        Cartesia 作备选（延迟更低）
  ├─ VAD: Silero
  ├─ Memory: Letta agent server（跨 session 持久化）
  └─ 音质反馈：异步跑，不进主对话循环
```

中文 TTS 未来扩日语/中文时用 **ElevenLabs v3** 或 **CosyVoice** 都能接，不会绑死。

### 差异化三板斧（三个都要有，缺一就是"又一个 ChatGPT 套壳"）

**🎯 板斧 1：为语言学习定制的记忆图谱（最核心）**

不是通用 mem0，而是结构化成：
```
user_profile       → L1、CEFR估计、目标（IELTS 7？商务？日常？）、兴趣、日程
vocab_srs          → 生词表，last-seen、due-date、success-rate，每次会话前挑 5-10 个 due 的自然带出
error_fossils      → 常犯错误列表（"interested about music" × 4 次），满 3 次从 recast 升级到 explicit
session_summaries  → 每次会话结束生成 3-5 条 bullet，下次开头注入
cefr_estimate      → 按 speaking/listening 分别滚动评估，不让用户考试
```

每次开始对话，"memory composer" 从这 5 层挑关键项塞进 system prompt。这个**结构是 ChatGPT generic memory 不会做、而且做不了的**，是真护城河。

**🎯 板斧 2：Agentic 外挂（真能跨出 App 的那种）**

至少做 3 个，立刻甩开所有对手：
- `vocab.export_to_anki(words)` — 一键把今日生词推 Anki
- `calendar.read_next_week()` — "你周三有面试，我们今天练英文面试"
- `reminder.set(time, phrase)` — "明天上午 10 点提醒你复习这 5 个词"
- 加分项：`podcast.pull_transcript(url)` — 把你听的播客做教材

**🎯 板斧 3：B2–C1 "silent majority" 定位**

Duolingo 垄断 A1–A2，Speak/Loora 在 B1 挤，B2+ 无人服务。产品默认用 B2-C1 风格说话，加地道表达、俚语、C1 生词并在上下文解释。用户说"太难"才降。**不要预先测级——前 3-5 次对话里偷偷用 LLM judge + 词汇多样性 + 迟疑率估算 CEFR**，需要时才显现。

### 教学法铁律（论文背书）

- **Interaction Hypothesis** — 必须主动反问、要求改述，不是被动接话
- **Output Hypothesis** — 用户发言时间 ≥ 80%，AI 别抢话
- **纠错策略分层**：
  - 小错（时态/冠词）→ **recast** 自然接（"Oh, so you *went* yesterday?"）
  - 反复错同一处（≥3次）→ session 末**显式**解释（"Quick note: 'interested **in**' not 'interested **about**'"）
- **SRS 隐形化** — 不要做成 Anki 样的卡片，把生词编织进下次对话里自然带出

### 产品形态（反直觉建议）

- **电话通话隐喻**，不是聊天窗 — 打开 app 点一下 3 秒内开始说话
- **禁止打字输入**，包括设置/测级/复习生词，全部用语音完成
- **AI 要"无条件耐心 + 不带评判"** — Reddit 用户最感恩的单一特征
- **不要 4 分钟硬切** — 想说多久说多久，Duolingo Max 这点被骂得最惨

### 可做的 MVP 路径（2-3 周）

**Week 1：** LiveKit Agents + Deepgram + gpt-4o-mini + ElevenLabs，能通话即可，无记忆无工具
**Week 2：** 接 Letta（或 mem0），做记忆 5 层中的 `user_profile` + `session_summaries` + `error_fossils`；接 3 个 tool（anki push / calendar read / reminder set）
**Week 3：** 加 recast/explicit 切换逻辑 + 隐形 CEFR 估算；真人跑 5-10 个 session 验证"记忆感"是否真实

英语先走通，**日语直接换 TTS 声源 + 换 prompt 的 L1/L2 对即可**，框架都能复用。

---

## 五、相关文件

- `01-commercial.md` — 商业产品逐个深度分析（含 ChatGPT Voice、Sesame、英语学习类等 22 款）
- `02-opensource.md` — 24+ 开源项目对比、架构图、代码样板
- `03-english-learning.md` — 18 款学习类产品教学法剖析 + 用户痛点 + 43 条引用源
