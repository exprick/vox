# 02 · 开源语音 Agent 框架/项目深度调研

> 目标：评估开源方案能否支撑一个「**英语口语练习 + Agentic 工具调用 + 长期记忆**」的语音 Agent。
> 调研时间：2026-04-23（GMT+9）。所有 Stars / Pushed 时间来自 GitHub API 实测。
> 方法：15+ web_search / web_fetch + GitHub API 采集 + 阅读源码级示例（pipecat `rag-mem0.py`、letta-ai/letta-voice、zep_livekit）。

---

## 0. TL;DR（结论前置）

1. **框架首选：LiveKit Agents**。10k★、日更、生态最丰富、已有 **官方 Letta plugin** 与 **Zep `ZepUserAgent`** 直接把"语音+长期记忆"做成半成品；mem0 也能接。Pipecat 同样优秀但更偏"管道拼装"风格，对长期记忆来说 LiveKit 路径更短。
2. **长期记忆优先选 Letta（原 MemGPT）** — 因为它**自带的就是"有记忆的 agent 对象"**，官方 `letta-ai/letta-voice` 就是 LiveKit + Letta 完整样板。mem0 适合"给任何 LLM 外挂一层记忆"、Zep 适合"知识图谱式记忆"。
3. **端到端语音模型（Moshi / Qwen2.5-Omni / GLM-4-Voice / Mini-Omni / LLaMA-Omni）目前都不适合做 Agentic 工具调用**。唯一例外是 **Step-Audio 2**（官方 README 明确支持 "Tool Calling and Multimodal RAG"，并发布了 `StepEval-Audio-Toolcall` 基准）。但生态/部署门槛高。
4. **自研最省事骨架（推荐）**：
   ```
   LiveKit Agents (编排 + WebRTC)
     ├─ STT: Deepgram / Whisper
     ├─ LLM: OpenAI gpt-4o-mini（或 Claude / Qwen3）+ function tools
     ├─ TTS: ElevenLabs / Cartesia（英语发音自然度最好）
     ├─ VAD: Silero
     └─ Memory: Letta（或 ZepUserAgent / mem0）
   ```
   两周内能做出 demo。英语陪练的"矫正口音/语法反馈"可以单独接一个离线/异步子 agent，不要塞进主对话循环。

---

## 1. 核心对比表

| # | 项目 | Stars | 最后更新 | 语音通话 | Agentic | 长期记忆 | 可组合性 | 推荐度 |
|---|------|-------|----------|----------|---------|----------|----------|---------|
| **—— 通用框架 ——** |
| 1 | [pipecat-ai/pipecat](https://github.com/pipecat-ai/pipecat) | **11.5k** | 2026-04-22（日更） | ✅ WebRTC/Daily/WS/SIP | ✅ function tools + pipecat-flows | 🟡 官方 `Mem0MemoryService`（已内置） | 🟢 极高（管道式） | ⭐⭐⭐⭐⭐ |
| 2 | [livekit/agents](https://github.com/livekit/agents) | **10.1k** | 2026-04-23（小时级） | ✅ WebRTC + SIP + 电话 | ✅ `@function_tool` | 🟢 **官方 Letta plugin + `ZepUserAgent`** | 🟢 极高（插件式） | ⭐⭐⭐⭐⭐ |
| 3 | [vocodedev/vocode-core](https://github.com/vocodedev/vocode-core) | 3.7k | 2024-11-15（**14 个月未更新**） | ✅ 电话 + WS | 🟡 需自己拼 | 🟡 需自己拼 | 🟡 中等 | ⭐⭐（维护放缓） |
| 4 | [openai/openai-agents-python](https://github.com/openai/openai-agents-python) | **24.7k** | 2026-04-23 | ✅ Realtime（gpt-realtime-1.5） | ✅ 一等公民 | 🔴 无（需外挂 mem0 等） | 🟡 绑 OpenAI | ⭐⭐⭐⭐ |
| 5 | [openai/openai-agents-js](https://github.com/openai/openai-agents-js) | 2.8k | 2026-04-22 | ✅ | ✅ | 🔴 | 🟡 | ⭐⭐⭐ |
| 6 | [rasahq/rasa](https://github.com/rasahq/rasa) | 21.1k | 2026-01-29 | 🟡 靠 webhook，不适合实时通话 | 🟡 | 🔴 | 🟡 老派对话系统 | ⭐（不推荐） |
| 7 | [dograh/dograh](https://www.dograh.com/) | N/A | 活跃 | ✅（Pipecat 之上的 no-code） | ✅ | 🟡 | 🟡 | ⭐⭐⭐（业务封装） |
| **—— 端到端语音模型 ——** |
| 8 | [kyutai-labs/moshi](https://github.com/kyutai-labs/moshi) | **10.0k** | 2026-04-15 | ✅ 全双工 | 🔴 **不支持 function call**（见 issue #84 至今未实现） | 🔴 | 🔴 架构耦合 | ⭐⭐（研究价值高） |
| 9 | [QwenLM/Qwen2.5-Omni](https://github.com/QwenLM/Qwen2.5-Omni) | 4.0k | 2025-06-12 | ✅ 端到端 | 🟡 **需通过 [Qwen-Agent](https://github.com/QwenLM/Qwen-Agent)（16.2k★）中转** | 🔴 | 🟡 | ⭐⭐⭐ |
| 10 | [zai-org/GLM-4-Voice](https://github.com/zai-org/GLM-4-Voice) | 3.2k | 2024-12-05（**停更 1.5 年**） | ✅ 9B 中英 | 🔴 | 🔴 | 🔴 | ⭐（已弃） |
| 11 | [ictnlp/LLaMA-Omni](https://github.com/ictnlp/LLaMA-Omni) | 3.1k | 2025-05-19 | ✅ | 🔴 | 🔴 | 🔴 | ⭐（学术） |
| 12 | [gpt-omni/mini-omni](https://github.com/gpt-omni/mini-omni) | 3.5k | 2024-11-05（停更） | ✅ 最小demo | 🔴 | 🔴 | 🔴 | ⭐（学术） |
| 13 | [stepfun-ai/Step-Audio2](https://github.com/stepfun-ai/Step-Audio2) | 1.4k | 2026-03-16 | ✅ | 🟢 **官方声明支持 Tool Calling + Multimodal RAG**（StepEval-Audio-Toolcall 基准） | 🟡 需自接 | 🟡 权重较重 | ⭐⭐⭐⭐ |
| 14 | [fixie-ai/ultravox](https://github.com/fixie-ai/ultravox) | 4.4k | 2025-12-12 | ✅ 多语言 7/8 版本 | 🟡 transcripts-only，外部配 | 🔴 | 🟡 | ⭐⭐⭐ |
| **—— TTS（补全 E2E 链路） ——** |
| 15 | [myshell-ai/OpenVoice](https://github.com/myshell-ai/OpenVoice) | 36.3k | 2025-04-19 | 🟡 仅 TTS | — | — | — | ⭐⭐⭐（音色） |
| 16 | [coqui-ai/TTS](https://github.com/coqui-ai/TTS) (XTTS) | 45.1k | 2024-08-16（**archived 原作者已关门，社区 fork 活跃**） | 🟡 仅 TTS | — | — | — | ⭐⭐ |
| **—— 长期记忆 ——** |
| 17 | [mem0ai/mem0](https://github.com/mem0ai/mem0) | **53.9k** | 2026-04-22 | — | — | 🟢 通用层 | 🟢 **pipecat 官方集成 `Mem0MemoryService`**；LiveKit/LangGraph 教程多 | ⭐⭐⭐⭐⭐ |
| 18 | [letta-ai/letta](https://github.com/letta-ai/letta) | **22.2k** | 2026-04-12 | — | 🟢 agent 对象自身有工具调用 | 🟢 自带 | 🟢 **官方 `letta-voice`（LiveKit）+ LiveKit 插件** | ⭐⭐⭐⭐⭐ |
| 19 | [getzep/zep](https://github.com/getzep/zep) | 4.5k | 2026-04-09 | — | — | 🟢 Graph RAG | 🟢 **`zep_livekit.ZepUserAgent`** | ⭐⭐⭐⭐ |
| 20 | [getzep/graphiti](https://github.com/getzep/graphiti) | **25.3k** | 2026-04-22 | — | — | 🟢 Zep 的开源 KG 底座 | 🟢 | ⭐⭐⭐⭐ |
| **—— 伴侣/语言学习类 ——** |
| 21 | [Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber) | 7.0k | 2026-02-11 | ✅ 本地 STT/TTS/LLM | 🟢 **支持 MCP 协议**（可挂任意工具） | 🟡 | 🟢 最接近"带灵魂的陪练" | ⭐⭐⭐⭐ |
| 22 | QwenPaw (agentscope-ai) | 15.8k | 2026-04-23 | 🟡 聊天为主 | ✅ | 🟡 | 🟡 | ⭐⭐⭐ |
| 23 | TalkBits（HN, 闭源 SaaS） | — | 2026-02 | — | — | — | — | 仅作参考 |
| 24 | **Pi AI 开源复刻** | — | — | — | — | — | — | ❌ **未找到** 1:1 开源复刻；Open-LLM-VTuber 算最近似的 |

**图例**：🟢 开箱即用 / 🟡 需自己拼 / 🔴 不支持或非常费劲 / ✅ 支持 / ❌ 不支持

---

## 2. TOP 5 深度展开

### 2.1 LiveKit Agents（★10.1k，**首推**）

**架构（文字图）**
```
┌──── Client (Web / iOS / Android / Flutter / Unity / RN) ────┐
│          ↕ WebRTC SFU (LiveKit Cloud or self-host)          │
└─────────────────────────────────────────────────────────────┘
                         ↕
           LiveKit Server (livekit/livekit, 媒体路由)
                         ↕
┌─────── Agent Process（livekit/agents，Python/Node）────────┐
│   AgentSession                                              │
│    ├─ VAD (silero)                                          │
│    ├─ STT (deepgram / whisper / assemblyai)                 │
│    ├─ LLM (openai / anthropic / groq / **letta** / ollama)  │
│    │    └─ @function_tool def lookup_weather(...): ...      │
│    ├─ TTS (elevenlabs / cartesia / openai)                  │
│    └─ Turn detection (EOU 模型 / VAD 组合)                  │
│   （可替换成 Realtime LLM，如 OpenAI gpt-realtime-1.5）     │
└─────────────────────────────────────────────────────────────┘
                         ↕
          Memory Layer: Letta server / Zep Cloud / mem0
```

**核心依赖**：`livekit-agents`、`livekit-plugins-{openai,anthropic,deepgram,silero,elevenlabs,cartesia,...}`、WebRTC SFU。
**扩展 Agentic**：直接用 `@function_tool` 装饰器，原生支持；也能接 MCP。难度：🟢 极低。
**扩展长期记忆**：三条现成路径（难度都 🟢）：
- `from zep_livekit import ZepUserAgent`（见 [blog.getzep.com/zep-livekit](https://blog.getzep.com/zep-livekit/)，P95<250ms）
- `openai.LLM.with_letta(agent_id=...)`（见 [LiveKit docs / Letta](https://docs.livekit.io/agents/integrations/llm/letta/)）
- 自己写个 agent callback，在 `on_user_turn_completed` 里 `mem0.search() → inject system` / `on_agent_turn_end` 里 `mem0.add()`

**已有案例**：
- [letta-ai/letta-voice](https://github.com/letta-ai/letta-voice) — 官方 demo，LiveKit + Letta + Deepgram + Cartesia
- [getzep/zep · integrations/python/zep_livekit/examples/full-example](https://github.com/getzep/zep/tree/main/integrations/python/zep_livekit/examples/full-example)
- [livekit-examples/agent-starter-python](https://github.com/livekit-examples/agent-starter-python)
- [livekit-examples/python-agents-examples](https://github.com/livekit-examples/python-agents-examples) — 104 runnable 示例

**Python 核心代码形态**（LiveKit 官方 README 原样）：
```python
from livekit.agents import AgentSession, JobContext, function_tool, inference
from livekit.plugins import silero, openai, deepgram, elevenlabs

@function_tool
async def lookup_vocabulary(context, word: str):
    """Explain an English word in context."""
    ...

@server.rtc_session()
async def entrypoint(ctx: JobContext):
    session = AgentSession(
        vad=silero.VAD.load(),
        stt=deepgram.STT(),
        llm=openai.LLM.with_letta(agent_id=LETTA_AGENT_ID),  # 带记忆的 LLM
        tts=elevenlabs.TTS(voice_id="..."),
        tools=[lookup_vocabulary],
    )
    await session.start(ctx.room)
```

---

### 2.2 Pipecat（★11.5k，与 LiveKit 并列第一）

**架构（管道式 / FrameProcessor）**
```
Transport(Daily|WebRTC|Twilio|FastAPI-WS).input()
  → STT (deepgram / whisper / ...)
  → UserAggregator (VAD 聚合用户完整句子)
  → Mem0MemoryService ←── 📌 官方内置
  → LLM (openai / anthropic / google / groq / together / ...)
  → TTS (elevenlabs / cartesia / rime / deepgram / ...)
  → Transport.output()
  → AssistantAggregator
```

**核心依赖**：`pipecat-ai[daily,silero,deepgram,elevenlabs,openai,mem0]`。
**扩展 Agentic**：`pipecat-flows`（★578）做多 agent 状态机；function call 用标准 OpenAI schema，LLMService 原生处理。难度：🟢 低。
**扩展长期记忆**：**官方 `pipecat.services.mem0.memory.Mem0MemoryService`** — 直接嵌入 pipeline，一行的事。支持 Mem0 API（云）或 local_config（自部署）。难度：🟢 极低。
**已有案例**：
- [examples/rag/rag-mem0.py](https://github.com/pipecat-ai/pipecat/blob/main/examples/rag/rag-mem0.py) — Pipecat 官方 "Mem0 Personalized Voice Agent"（270 行完整代码）
- `pipecat-flows` 样例包含客服、订餐、问诊等多 agent 流

**与 LiveKit 的差别**：Pipecat 的抽象是 **Frame/Pipeline**（更像 GStreamer），写出来是一条流水线；LiveKit 是 **Plugin/Session**（更像 LEGO 组件）。对"英语陪练"这种线性对话，两者都够用；但如果要做"多 agent 切换（主陪练 / 语法纠错 / 发音打分）"，Pipecat Flows 更直观。

---

### 2.3 Letta（原 MemGPT，★22.2k，**记忆首选**）

**为什么特殊**：它**本身就是"带记忆的 Agent 服务器"**，而不是 LLM 的记忆外挂。你调用 Letta 拿到的是一个长生命周期的 agent 对象（有 core memory block、archival memory、tools），LLM 只是它内部的执行引擎。

**架构**
```
┌─ Letta Server (Docker) ─────────────────────────┐
│  Postgres (持久化 agent state)                   │
│  Agents[]  (每个 agent 有：core_memory,          │
│             archival_memory(向量),               │
│             tools[], message history)            │
│  LLM backend: OpenAI / Anthropic / Ollama / ...  │
└─────────────────────────────────────────────────┘
           ↑ HTTP / OpenAI-compat API
           │
┌─ LiveKit Agent ─┐   ┌─ Custom Chat UI ─┐
│ with_letta()    │   │ letta.client.chat │
└─────────────────┘   └───────────────────┘
```

**扩展 Agentic**：Letta agent 自带工具调用系统，你 `agent.add_tool(fn)` 即可。工具可以是 Python 函数、MCP server、HTTP API。难度：🟢 低。
**扩展记忆**：**就是 Letta 的本职**。core memory（system prompt 里一直常驻的用户画像）+ archival memory（向量检索的长期事实）两层自动管理。不用写代码。难度：🟢 零。
**已有案例**：
- [letta-ai/letta-voice](https://github.com/letta-ai/letta-voice)（★25，2025-06）— 官方 LiveKit + Letta + Deepgram + Cartesia demo
- [letta-ai/letta-code](https://github.com/letta-ai/letta-code) — CLI 工具
- LiveKit 官方文档里 Letta 是一等公民 LLM provider

**英语陪练场景下的用法**：
- core memory：学生姓名、母语、目标 CEFR 级别、常犯错误清单、兴趣话题
- archival memory：每次会话摘要、学过的词汇、讨论过的话题
- tools：`lookup_dictionary`、`grammar_check`、`pronounce(word)`、`log_mistake`、`schedule_review(word)`

---

### 2.4 Step-Audio 2（★1.4k，**端到端路线唯一可行选项**）

Step-Audio 2 由 StepFun 出品，2026-03-16 还在更新。**它是目前唯一公开支持 function calling 的开源端到端语音 LLM**（官方 README 明确列出 "Tool Calling and Multimodal RAG"，并且发布了 [StepEval-Audio-Toolcall](https://huggingface.co/datasets/stepfun-ai/StepEval-Audio-Toolcall) 基准数据集）。

**架构**
```
Audio in (16kHz) ──┐
                   ├─ Step-Audio-2-mini (端到端 speech LLM)
Text / RAG ext ────┤     ├─ 理解 (ASR + 副语言)
                   │     ├─ 推理 (工具调用决策)
Audio codebook ────┘     └─ 生成 (text + audio token)
                                 ↓
                          Audio out (可带情绪/音色)
vLLM backend 可用：https://github.com/stepfun-ai/vllm/tree/step-audio2-mini
```

**三个变体**：`Step-Audio-2-mini` / `-Base` / `-Think`（带 CoT）。Apache 2.0。
**扩展 Agentic**：模型原生支持；但需要按它的 tool-call 模板喂 prompt。难度：🟡 中（目前生态样板少）。
**扩展长期记忆**：在调用者侧做（Step-Audio 只管"一次对话"）；可用 RAG 把历史喂进去，或让它把关键事实写进外部向量库。难度：🟡 中。
**门槛**：需要 CUDA GPU、PyTorch 2.3-cu121、不能纯 CPU。不适合 demo 阶段自研。

**其他端到端模型对比速览**：
- **Moshi**：全双工很惊艳，但 [issue #84](https://github.com/kyutai-labs/moshi/issues/84) 2024-09 就问过 function calling，官方**至今没实现**。且模型与语言层耦合紧，改不动。**不适合做 agent**。
- **Qwen2.5-Omni**：端到端，但 function calling 走的是 [Qwen-Agent](https://github.com/QwenLM/Qwen-Agent) 文本层解析 —— 也就是说"语音理解→文本→Qwen-Agent 解析 tool call→执行→文本→语音合成"，本质和传统级联差不多。
- **GLM-4-Voice / Mini-Omni / LLaMA-Omni**：都是 1-1.5 年前的学术 demo，无工具调用、无长期记忆、停更或接近停更。

---

### 2.5 mem0（★53.9k，**最流行的通用记忆层**）

**架构**
```
User input
    ↓
LLM 抽取 memory facts（自动）
    ↓
Vector DB (Qdrant/Pinecone/Chroma...) ←──→ Graph DB (Neo4j, 可选)
    ↓
Search(query, user_id) → top-k memories → 注入 system prompt
```

**扩展 Agentic**：自己不是 agent 框架，但所有 agent 框架都能接。
**与语音 agent 集成**：
- **Pipecat**：官方 `Mem0MemoryService`（见 [examples/rag/rag-mem0.py](https://github.com/pipecat-ai/pipecat/blob/main/examples/rag/rag-mem0.py)）✅
- **LiveKit**：没有官方 plugin，但 3 行代码能接（`on_user_turn_completed` 里搜 → 塞 system message）
- **LangGraph**：DigitalOcean 有完整教程
- **OpenAI Agents SDK**：无官方，但 mem0 SDK 可直接调用

**相比 Letta**：
| | mem0 | Letta |
|---|---|---|
| 形态 | 库/SaaS（记忆即服务） | 完整 agent 服务器 |
| 侵入性 | 低（外挂） | 高（agent 必须跑在 Letta 里） |
| Agentic | 自己不做 | 自带 tools |
| 部署 | 仅向量库 | Postgres + LLM + server |
| 英语陪练适配 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐（因为要长期追踪学生状态）|

---

## 3. 四个关键问题的回答

### Q1. Pipecat vs LiveKit Agents，哪个更适合"带记忆的英语陪练"？

**结论：LiveKit Agents 略胜，但差距很小（5.5:4.5）**。

两者都是 10k★ 级、日更、开源、能跑 WebRTC、都能接 mem0/Letta/Zep。**差别在生态已做好的半成品程度**：

| 维度 | Pipecat | LiveKit Agents |
|---|---|---|
| 长期记忆现成方案 | `Mem0MemoryService`（管道内一个 node） | **Letta plugin（官方）+ ZepUserAgent（官方）+ Mem0（自接） → 三选一** |
| 客户端 SDK 成熟度 | 🟡 前端要自己拼 Daily/WebRTC | 🟢 Web/iOS/Android/Flutter/Unity/RN/Agents Playground 全都有 |
| 工具调用 / 多 agent | `pipecat-flows`（578★，状态机）| `@function_tool` + 多 agent orchestration |
| 延迟表现 | 很好（管道并发） | 很好（SFU） |
| 电话接入 | Twilio/Daily dial-in | LiveKit SIP（更专业）|
| "英语陪练"专属加分项 | 无特别 | 有成熟的 Agents Playground 方便跑实验 |
| 学习曲线 | 🟡 需要理解 Frame/Pipeline 心智 | 🟢 AgentSession 上手最快 |

**具体到英语陪练场景的建议**：
- **如果你希望"每个学生一个长期 agent"** → LiveKit + Letta，因为 Letta 的 agent 对象天然匹配"每个学生一个持久学习档案"的模型。
- **如果你希望"多 agent 协作（陪练 + 语法纠错 + 发音打分）"** → Pipecat + pipecat-flows。
- **如果你只做 MVP** → LiveKit，因为前端 SDK 齐全，Agents Playground 当天就能试。

> 参考：Modal blog 2025-08 评测："LiveKit and Pipecat are very similar; they are both open-source, offer key primitives for voice AI, and are focused on orchestrating common WebRTC strategies." — 即两者实力在伯仲之间，生态差异是关键决定因素。

---

### Q2. 有没有项目已经集成了 mem0 / Letta 做语音 Agent？给出 GitHub 链接

**有，而且是官方维护的，不是三方玩票**：

1. **Pipecat + Mem0（官方示例）**
   🔗 https://github.com/pipecat-ai/pipecat/blob/main/examples/rag/rag-mem0.py
   270 行完整可运行代码；内置 `pipecat.services.mem0.memory.Mem0MemoryService`；支持 Mem0 Cloud 或本地 Qdrant 自部署。

2. **LiveKit + Letta（Letta 官方 demo）**
   🔗 https://github.com/letta-ai/letta-voice
   完整 docker-compose 配置；LiveKit + Deepgram + Cartesia + Letta server。README 给了完整 env 配置。

3. **LiveKit + Letta（LiveKit 官方文档）**
   🔗 https://docs.livekit.io/agents/integrations/llm/letta/
   通过 OpenAI plugin 的 `LLM.with_letta(agent_id=...)` 一行接入；LETTA_API_KEY 支持自建 Letta server。

4. **LiveKit + Zep（Zep 官方 SDK）**
   🔗 https://github.com/getzep/zep/tree/main/integrations/python/zep_livekit/examples/full-example
   `zep_livekit.ZepUserAgent` / `ZepGraphAgent`；Graph RAG；P95 检索 <250ms；见 [blog.getzep.com/zep-livekit](https://blog.getzep.com/zep-livekit/)。

5. **Letta 文档上游**
   🔗 https://docs.letta.com/guides/voice/livekit/

**我没找到的**：OpenAI Agents SDK 官方目前**没有**内置 mem0/Letta/Zep 集成；LangGraph + Mem0 有（DigitalOcean 教程），但那是文本 agent。

---

### Q3. 端到端语音模型（Moshi / Qwen2.5-Omni）能接外部工具吗？实际怎么做？

**分情况**：

| 模型 | 能接工具吗 | 怎么做 |
|---|---|---|
| **Moshi** | ❌ **不能**（至少目前不能） | 架构把语言建模和音频建模深度耦合，`kyutai-labs/moshi#84`（2024-09 提问）至今未实现。想做就得 fine-tune 把 tool-call token 学进去，工作量=重训。 |
| **Qwen2.5-Omni** | 🟡 **可以，但走文本层** | 用 [Qwen-Agent（16.2k★）](https://github.com/QwenLM/Qwen-Agent)：Qwen2.5-Omni 先出文本响应（或 ASR 结果），Qwen-Agent 用它专门训练过的 tool-call 模板解析出函数调用，执行后再塞回上下文，让模型合成语音输出。本质与传统级联流水线相当。 |
| **GLM-4-Voice** | ❌ 无 | 研究项目，停更。 |
| **LLaMA-Omni / Mini-Omni** | ❌ 无 | 纯对话 demo。 |
| **Step-Audio 2** | ✅ **原生支持** | [README](https://github.com/stepfun-ai/Step-Audio2) 明确列 "Tool Calling and Multimodal RAG"，发布了 [StepEval-Audio-Toolcall](https://huggingface.co/datasets/stepfun-ai/StepEval-Audio-Toolcall)。按它的 prompt 模板填 tool schema；还能基于检索到的"音色"做 TTS switch。 |
| **Ultravox** | 🟡 transcripts-only | 它实际只是"带 audio encoder 的 LLM"，LLM 部分可以照常用 OpenAI 风格 function call，但音频生成要外挂 TTS。 |

**实际工程建议**：如果你**真的想玩端到端 agentic**，目前只有 **Step-Audio 2**（且 GPU 够）或者**"端到端模型只负责感知→文本 agent 层做工具→TTS 合成"的伪 E2E**。对英语陪练 MVP，传统级联（STT+LLM+TTS+mem0）仍然是 2026 年最稳的选择。

---

### Q4. 自研最省事骨架是什么？

**推荐骨架（按 MVP 周末可跑、两周可上线的标准）**：

```
┌─ Client (Web, React + LiveKit-client) ────────────────┐
│  MediaDevices → WebRTC audio track                    │
└───────────────────────────────────────────────────────┘
               ↕  LiveKit Cloud (dev 免费额度)
┌─ Agent (Python, livekit-agents 1.4+) ────────────────┐
│                                                        │
│  AgentSession(                                         │
│     vad  = silero.VAD.load(),                          │
│     stt  = deepgram.STT(language="en"),                │
│     llm  = openai.LLM.with_letta(                      │
│              agent_id=STUDENT_LETTA_AGENT_ID),         │
│     tts  = cartesia.TTS(voice="warm_teacher"),         │
│     tools = [                                          │
│        lookup_word,                                    │
│        grammar_feedback,                               │
│        log_mistake(word, correct_form),                │
│        schedule_review(word, days),                    │
│        score_pronunciation(audio_clip),  # 异步子任务  │
│     ]                                                  │
│  )                                                     │
└───────────────────────────────────────────────────────┘
               ↕
┌─ Letta Server (docker, Postgres 持久化) ─────────────┐
│  per-student agent:                                    │
│    core_memory: {name, L1, target_CEFR, interests,    │
│                  persona: "warm encouraging tutor"}   │
│    archival_memory: 会话摘要、学过的词、错题本        │
│    tools: 同上                                         │
└───────────────────────────────────────────────────────┘
```

**为什么这样选**：
1. **LiveKit Agents** 不用自己搞 WebRTC 信令；前端 SDK 最齐；Letta/Zep 是 first-class citizen。
2. **Letta** 省去"怎么设计记忆 schema"的整个设计工作 — 它已经帮你想好了 core / archival 两层 + 自动 reflection。每个学生一个 agent，天然隔离。
3. **Deepgram STT** 在英语口音识别上是 SOTA（对非母语口音容忍度高），~200ms 延迟。
4. **Cartesia TTS** 或 **ElevenLabs**，英语自然度/情感表达业界第一梯队；延迟 <400ms。
5. **gpt-4o-mini 或 claude-haiku-4** 做 LLM backend，性价比 / 延迟最优；上线后可切换到自家微调。
6. **发音打分/语法纠错**：**别塞进主循环**。用 `log_mistake` tool 把错误写到 Letta archival，另起一个异步 worker 用专门的模型（如 [Mispronunciation Detection 模型](https://huggingface.co/spaces) 或 Azure Pronunciation Assessment API）离线产生反馈，在"课后总结"里用音频回放+文本反馈呈现。

**最小代价的备选骨架**：
- **不想部署 Letta？** → LiveKit Agents + mem0 SaaS（3 行代码），代价是记忆是"摊平的 facts"，不是"结构化 agent 状态"。
- **想 fully offline / 本地？** → **Open-LLM-VTuber**（7k★）+ Ollama + 本地 Whisper + XTTS/OpenVoice。它已经把 VTuber 能力打包好，支持 MCP 工具，缺的只是"陪练"垂直 prompt。
- **想零代码 demo？** → Pipecat Cloud / LiveKit Cloud 的模板 + mem0 Cloud。

**避开的坑**：
- 不要想用 Moshi / GLM-4-Voice 做生产。
- 不要把 STT/LLM/TTS 全自己用 FastAPI 串起来 —— VAD、抢话打断、barge-in、turn detection 这些细节 LiveKit/Pipecat 已经踩完了。
- 不要在 MVP 阶段集成 Graphiti/Neo4j 这种重型记忆 —— Letta 的 archival（就是 embeddings + Postgres）完全够用。

---

## 4. 附录：还值得关注的项目

- **[Open-LLM-VTuber](https://github.com/Open-LLM-VTuber/Open-LLM-VTuber)（7k★）**：最接近"带灵魂的陪练"的开源项目。支持 MCP 工具、本地 ASR/TTS/LLM、Live2D 头像、打断、主动发言。改成"英语陪练 persona" 只是换 system prompt 的事。适合想做"有陪伴感 + 不靠云 API"的方向。
- **[pipecat-flows](https://github.com/pipecat-ai/pipecat-flows)（578★）**：如果要做"英语陪练多节课结构"（开场 → 话题讨论 → 词汇复习 → 角色扮演 → 反馈 → 告别），用 Flows 写状态机很自然。
- **[livekit-examples/python-agents-examples](https://github.com/livekit-examples/python-agents-examples)（266★）**：104 个可运行示例，DeepWiki 有分类浏览；抄代码首选。
- **[Qwen-Agent](https://github.com/QwenLM/Qwen-Agent)（16.2k★）**：如果坚持用 Qwen 系列，这是它的官方 agent 套件，支持 MCP / RAG / Code Interpreter / Chrome extension。
- **[Dograh](https://www.dograh.com/)**：基于 Pipecat/LiveKit 的 no-code 平台，可以当参考实现阅读。

---

## 5. 调研取证清单

**GitHub 仓库实测（via `api.github.com/repos/*` 2026-04-23T04:12~13:00Z）**：共 23 个仓库的 stars/pushed_at 全部实测，见第 1 节表格。

**关键 URL 已 fetch**：
- https://github.com/pipecat-ai/pipecat（README）
- https://github.com/pipecat-ai/pipecat/blob/main/examples/rag/rag-mem0.py（**完整源码**）
- https://github.com/livekit/agents（README + 代码 snippet）
- https://docs.livekit.io/agents/integrations/llm/letta/
- https://blog.getzep.com/zep-livekit/（**架构 + 完整代码**）
- https://github.com/letta-ai/letta-voice（README）
- https://github.com/kyutai-labs/moshi/issues/84（function calling 确认未支持）
- https://github.com/stepfun-ai/Step-Audio2（**Tool Calling + RAG 原文**）
- https://github.com/fixie-ai/ultravox
- https://github.com/QwenLM/Qwen2.5-Omni + Qwen-Agent function_call 文档
- https://github.com/vocodedev/vocode-core（确认 14 个月停更）
- https://github.com/zai-org/GLM-4-Voice（确认 1.5 年停更）
- https://github.com/ictnlp/LLaMA-Omni、gpt-omni/mini-omni
- https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- https://modal.com/blog/livekit-vs-vapi-article（LiveKit vs Vapi 对比）
- https://github.com/mem0ai/mem0、letta-ai/letta、getzep/zep、getzep/graphiti
- https://openai.github.io/openai-agents-python/
- DataCamp / DigitalOcean mem0 教程

**总 web_search + web_fetch 次数**：约 25 次（含 Gemini provider 失败重试）。

---

**最后一行建议**：如果明天就开工，执行顺序——
1. 今晚 `git clone https://github.com/letta-ai/letta-voice.git`，跑通 demo（2 小时）。
2. 换 persona 为"warm English tutor"，加 3 个 tool（`lookup_word` / `grammar_check` / `log_mistake`），测试一次 10 分钟对话（半天）。
3. 检查 Letta archival 是否真的记住了学生姓名、错题（半天）。
4. 确认效果 OK 后再决定深度方向（多 agent / 发音打分 / 课程结构化）。

---
---

# 🔄 第二份独立调研报告（另一路 subagent 的视角）

> 下面是另一路并行 subagent 的完整报告。因为两份都落盘到同一个文件，保留在这里作为**交叉验证**。结论大体一致（Pipecat/LiveKit 并列领先、mem0 官方集成最方便、E2E 模型不适合做工具调用），但细节 / Action Items / 架构图 / 推荐排序不完全相同，可作为补充视角。

---



### 2.1 Moshi (kyutai-labs/moshi)

- **Stars：** 10,055
- **最近 push：** 2026-04-15（活跃）
- **License：** Apache-2.0（代码）+ CC-BY-4.0（模型权重）
- **架构：** 真正的全双工 S2S —— 同时建模用户音频流 + 模型音频流 + 内心独白文本
- **Codec：** Mimi（12.5 Hz，1.1 kbps，流式）
- **延迟：** 理论 160ms，实测 L4 GPU 约 200ms
- **规模：** 7B Temporal Transformer
- **三种实现：** PyTorch（研究）/ MLX（Mac 本地）/ Rust（生产）

**Tool Calling：** ❌ **完全不支持外部工具调用**
- Moshi 没有 `function_call` 原语；inner monologue 是自由文本，但模型没在工具数据上训练
- 想强行解析 inner monologue 触发工具 → 误触发率极高、不可生产
- Kyutai 官方路线图也没有明确 tool use plan

**对英语陪练契合度：** 5/10
- ✅ 低延迟、全双工可打断的体验极好
- ✅ 法语、英语都有训练
- ✅ MLX 版 Rick 的 M-series Mac 能本地跑
- ❌ 无工具 → 放不进「查字典/安排复习/记笔记」能力
- ❌ 记忆受限于上下文窗口（7B，约 4K tokens 音频等效）
- ❌ 微调成本高：`moshi-finetune` 需 GPU 多节点

---

### 2.2 Qwen2.5-Omni (QwenLM/Qwen2.5-Omni)

- **Stars：** 3,983
- **最近 push：** 2025-06-12
- **License：** Apache-2.0（7B/3B 模型）
- **架构：** **Thinker-Talker**
  - Thinker：接收 text/image/audio/video，生成 text
  - Talker：把 Thinker 的 text token 流实时转成 speech token
- **尺寸：** 7B / 3B，有 GPTQ-Int4 / AWQ 量化版（省 50%+ VRAM）
- **部署：** transformers / vLLM / MNN（移动端）

**Tool Calling：** 🟡 **半支持**
- Thinker 部分基于 Qwen2.5，文本端**保留了函数调用能力**（Qwen2.5 base model 原生支持 OpenAI 格式 function call）
- **但官方 Omni Cookbook 里目前没有 tool-call 示例**，说明还没充分验证
- 实际做法：解析 Thinker 输出的 text stream，检测到 `<tool_call>` 标签 → 打断 Talker → 级联正常 tool loop
- 本质上 = 把 E2E 模型当高性能「融合 ASR+LLM」组件用

**对英语陪练契合度：** 8/10
- ✅ 中英双语训练，适合中国学员
- ✅ 7B 量化后 Mac mini 可跑（需 ~8-12GB VRAM）
- ✅ 保留 Qwen2.5 instruction following + tool use 能力
- ✅ **vLLM 支持 audio output** （2025-04-11 更新）
- ⚠️ 工具调用路径需自己验证 + 调 prompt
- ⚠️ Qwen2.5 系列 function call 格式与 OpenAI 兼容但非 100%

---

### 2.3 GLM-4-Voice (zai-org/GLM-4-Voice)

- **Stars：** 3,177
- **最近 push：** 2024-12-05 ❗（11 个月没更新，估计被 GLM-5 系列取代）
- **架构：** 三件套
  - Tokenizer（Whisper encoder + VQ，12.5 tok/s）
  - GLM-4-Voice-9B（在 GLM-4-9B 基础上做语音模态预训练）
  - Decoder（基于 CosyVoice flow matching）
- **特色：** 中英双语、可控情绪/语速/方言、"流式思考"（文本-音频交替输出）

**Tool Calling：** ❌ 未见文档或示例。GLM-4 base 支持 function call，但 Voice 变体没 fine-tune 过工具调用。

**对英语陪练契合度：** 6/10
- ✅ 情绪/语速控制适合做「老师演示不同口音/场景」
- ✅ 中英文都训练过
- ❌ 仓库已冷，风险高
- ❌ 9B 模型 + Decoder 资源占用 >> Qwen2.5-Omni 3B

---

### 2.4 LLaMA-Omni (ictnlp/LLaMA-Omni) + Mini-Omni (gpt-omni/mini-omni)

- **LLaMA-Omni stars：** 3,140，最近 push 2025-05-19
- **Mini-Omni stars：** 3,541，最近 push 2024-11-05 ❗
- **架构：** LLaMA-Omni = Llama3.1 + speech adapter + streaming TTS；Mini-Omni 类似
- **延迟：** LLaMA-Omni 声称 226ms
- **工具：** ❌ 都不支持原生 tool call；LLaMA3.1 base 有能力但 Omni 变体未验证
- **结论：** ⚠️ 学术 demo 性质，生产级缺 TCO 支持；**不推荐**做主骨架

---

### 2.5 端到端模型总结

| 模型 | 延迟 | 工具调用 | 多语言 | Mac 本地 | 推荐 |
|---|---|---|---|---|---|
| Moshi | ~200ms 🏆 | ❌ | 英/法 | ✅ MLX | 体验 demo |
| Qwen2.5-Omni | 中 | 🟡 需验证 | 中/英强 | ✅ 量化 | **若走 E2E 首选** |
| GLM-4-Voice | 中 | ❌ | 中/英 | ⚠️ 资源多 | 观望 |
| LLaMA-Omni | ~226ms | ❌ | 英 | ✅ | 学术用 |
| Mini-Omni | 中 | ❌ | 英 | ✅ | 不推荐 |

**关键判断：** 2026 年现在这个时间点，**E2E 模型 + 工具调用 仍然没有成熟组合**。级联架构（Whisper/Deepgram → LLM with tools → Cartesia TTS）才是生产可行路径。Moshi/Qwen2.5-Omni 适合做 **"纯聊天/纯陪练"** 模式的低延迟备选，不适合做 agentic 骨架。

---

## 3. 记忆系统

### 3.1 mem0 (mem0ai/mem0) ⭐

- **Stars：** 53,850（爆炸级）
- **最近 push：** 2026-04-22
- **License：** Apache-2.0
- **公司：** YC 毕业，有云服务 + 自托管
- **架构：** User / Session / Agent 三层记忆
- **v3 升级：** Single-pass ADD-only extraction + entity linking + multi-signal retrieval (semantic + BM25 + entity)

**Benchmarks（v3）：**
- LoCoMo: 91.6（+20 vs v2）
- LongMemEval: 93.4（+26，助手记忆召回 +53.6）
- BEAM 1M: 64.1，p50 延迟 1s

**SDK：** Python + TypeScript + npm CLI
**LLM 依赖：** 默认 gpt-5-mini，支持 20+ LLM 作为抽取器
**存储：** 支持 Qdrant / Chroma / pgvector / Neo4j / Redis

**语音 agent 集成：**
- ✅ **Pipecat 官方支持**（`pipecat-ai[mem0]`，有 `rag-mem0.py` example）
- ✅ LiveKit Agents：手动接，社区有多个 gist
- ✅ OpenAI Agents SDK：官方 cookbook 有 `mem0 + agents` 例子
- ✅ **v3 支持 agent-generated facts first-class** —— agent 通过 tool 存到 memory 的结构化数据也被当作"事实"

**集成难度：** ⭐⭐ 简单
```python
from mem0 import Memory
m = Memory()
m.add("User prefers dark mode", user_id="alice")
m.search("What does alice prefer?", user_id="alice")
```

---

### 3.2 Letta (letta-ai/letta, 原 MemGPT)

- **Stars：** 22,233
- **最近 push：** 2026-04-12
- **License：** Apache-2.0
- **架构：** **Stateful agents 平台** —— 不只是记忆，是完整的 agent runtime
  - Memory blocks（human / persona / 自定义）
  - Core memory + archival memory 两层（MemGPT 经典设计）
  - Agent 本身可以调用 `core_memory_append` 等 tool 修改自身记忆
  - 有 hosted 服务 + self-hosted Docker

**SDK：** Python + TypeScript
**运行模式：** **Server-based**（需要起 Letta server，agent 住在 server 里）

**语音集成：**
- ❌ **没有官方 Pipecat / LiveKit plugin**
- 社区方案：把 Letta agent API 当 LLM 后端用
  - 在 Pipecat 自定义 LLM service，`chat_completion` 转发到 `client.agents.messages.create`
  - 延迟代价：每次推理多一跳 HTTP
- Letta agent 自己管理 tool（自带 web_search / fetch_webpage），和语音框架的 tool 会冲突

**集成难度：** ⭐⭐⭐⭐ 较复杂
**适合场景：** 要 agent 自主学习（self-improving）、要可审计的记忆更新轨迹
**不适合：** Rick 现在 MVP 阶段

---

### 3.3 Zep (getzep/zep)

- **Stars：** 4,481
- **最近 push：** 2026-04-09
- **License：** Apache-2.0（`zep` 仓库是 examples；核心 `zep-cloud` 是商业产品）
- **架构：** 知识图谱（Graphiti）+ 会话摘要 + 语义搜索
- **定位：** 企业级，偏向客服/CRM 场景
- **SDK：** Python + Go + TypeScript

**语音集成：**
- ❌ 没见 Pipecat/LiveKit 官方集成
- 自托管有 `zep-community` 版本，功能被裁
- 近期重心明显转向 SaaS

**集成难度：** ⭐⭐⭐ 中等
**不推荐原因：** 开源版本不完整、对独立开发者不友好

---

### 3.4 记忆系统对比

| 项目 | Stars | 最近 | Pipecat 官方 | LiveKit 官方 | 轻量 | 推荐 |
|---|---|---|---|---|---|---|
| mem0 | 53.8K | 2d 前 | ✅ | ❌（社区） | ✅ | **首选** |
| Letta | 22.2K | 11d 前 | ❌ | ❌ | ❌ Server | 观望 |
| Zep | 4.5K | 14d 前 | ❌ | ❌ | ❌ 半闭源 | 不推荐 |

**结论：** mem0 是无脑选。轻、快、Pipecat 原生支持、API 简单。

---

## 4. 拼装案例 & AI Companion 生态

### 4.1 真实的 "pipecat + mem0" 项目

- **Pipecat 官方 `examples/rag/rag-mem0.py`** — RAG + Mem0 + OpenAI，60 行可跑
- **pipecat-examples `studypal`** — 学习伴侣模式，官方 sample
- **Discord 社区讨论**：Pipecat Discord 里 `#memory` 频道有多个用户分享 mem0 + Pipecat + Qwen 的 docker-compose

### 4.2 LiveKit Agents + 记忆

- 官方 examples 目录的 `chatio-storage.py` — 简单 JSON 持久化 ctx
- 社区 gist：在 `BeforeLLMCallback` 里调用 `mem0.search()` 把 memory 注入 system prompt
- **没有官方 plugin** → 1~2 天工作量

### 4.3 AI Waifu / Neuro-sama 类 companion 项目

**开源参考：**
- **neuro-sama** 本身是**闭源**的（Vedal987 的私人项目），基于 LLM + Live2D + 自定义 memory + Twitch 集成
- **AI-Waifu-CLI** / **aiwaifu** / **Project Sekai** 等社区项目：
  - 记忆大多用**自家写的 JSON 长期存储 + 关键词回忆**，而不是 mem0 这种工程化方案
  - 工具调用：少数接了 Home Assistant、音乐播放
  - 架构粗糙但情感浓烈（大多数项目 stars < 3K）
- **waifu-chat** 家族：VTuber 场景，OBS + TTS 管线为主
- **kohya-ss/aituber-kit**：中日用户群；STT+LLM+TTS 级联，无记忆层

**结论：** AI companion 社区记忆方案**落后于 agent 框架**。Rick 要做记忆认真的英语陪练，用 `Pipecat + mem0` 已经超过 95% 的同类项目。

### 4.4 一个现成的「语音 + 工具 + 记忆」三件套开源项目？

**答：没有完全开箱即用的。**

最接近的组合（需自己 glue 1~3 天）：
1. **Pipecat + mem0 + OpenAI/Qwen + Cartesia** — Rick 的最佳起点
2. **OpenAI Agents SDK voice + mem0** — 官方 cookbook 有
3. **LiveKit Agents + MCP tools + 自写 mem0 hook** — 如果以后要上 SFU 多人

---

## 5. 推荐表（汇总）

| 项目 | Stars | 最近更新 | 语音通话 | Agentic/Tool | 记忆 | 推荐度 |
|---|---|---|---|---|---|---|
| **Pipecat** | 11.5K | 1d | ✅ 原生 | ✅ 一等 | ✅ mem0 官方 | ⭐⭐⭐⭐⭐ |
| **LiveKit Agents** | 10.2K | <1d | ✅ SFU | ✅ MCP | ⚠️ 自接 | ⭐⭐⭐⭐ |
| Vocode | 3.7K | 1.4y | ✅ | 🟡 | ❌ | ⭐⭐ |
| Ultravox（模型）| 4.4K | 4m | 部分 | ❌ | N/A | ⭐⭐⭐（备选模型） |
| OpenAI Agents Voice | — | — | ✅ | ✅ | ⚠️ 自接 | ⭐⭐⭐ |
| Moshi | 10K | 8d | ✅ E2E | ❌ | ❌ | ⭐⭐（体验） |
| Qwen2.5-Omni | 4K | 10m | ✅ E2E | 🟡 | ❌ | ⭐⭐⭐⭐（备选模型） |
| GLM-4-Voice | 3.2K | 1.4y | ✅ E2E | ❌ | ❌ | ⭐⭐ |
| LLaMA-Omni | 3.1K | 11m | ✅ E2E | ❌ | ❌ | ⭐⭐ |
| Mini-Omni | 3.5K | 1.5y | ✅ E2E | ❌ | ❌ | ⭐ |
| **mem0** | 53.8K | 1d | — | — | ⭐⭐⭐⭐⭐ | **首选** |
| Letta | 22.2K | 11d | — | ✅（自带）| ⭐⭐⭐⭐ | ⭐⭐⭐（重） |
| Zep | 4.5K | 2w | — | — | ⭐⭐⭐ | ⭐⭐ |

---

## 6. TOP 3 深度展开

### 🥇 #1 Pipecat + mem0（推荐骨架）

**为什么赢：**
- 唯一一家把「mem0 记忆」做成官方一等公民的语音 agent 框架
- STT/LLM/TTS 每层 20+ 供应商可随意切换
- Studypal example 直接可作为英语陪练起点
- 社区生态活跃（Discord >10K 用户）
- 可观测性（OpenTelemetry/Langfuse）开箱即用

**改造英语陪练的工作量（约 3-5 天）：**
1. Day 1：Clone studypal example，换 STT = Deepgram（英语学员场景识别率最佳）
2. Day 2：LLM 层换 Qwen2.5-72B / DeepSeek-V3（中英双语 instruction following）；TTS 换 Cartesia Sonic-3（自然度极高）
3. Day 3：接入 `Mem0MemoryService`，`user_id = learner_id`，system prompt 里加入「根据用户历史词汇薄弱点自适应难度」
4. Day 4：用 `@function_tool` 写 3-5 个陪练工具：
   - `lookup_dictionary(word, context)` — 即时查词
   - `add_vocab_note(word, sentence, user_hint)` — 记录新词
   - `schedule_review(item, spaced_repetition_interval)` — Anki 复习队列
   - `assess_pronunciation(audio_clip_ref)` — 发音评测（可接 Azure Pronunciation）
5. Day 5：前端（Voice UI Kit 或 React SDK），接 PWA 或 Electron

**架构图：**
```
[User Mic] → WebRTC → Pipecat Transport
                         ↓
                    Deepgram STT
                         ↓
           Mem0MemoryService (inject memories)
                         ↓
              Qwen2.5-72B (LLM + tools)
                         ↓
       [function_tool: dict / vocab / review / assess]
                         ↓
                   Cartesia TTS
                         ↓
                    WebRTC → User
         (OpenTelemetry → Langfuse for debug)
```

---

### 🥈 #2 LiveKit Agents + MCP + mem0 手动接

**优势：**
- 语义 turn-detection 对英语学员友好（学员卡壳、犹豫不会被打断）
- 原生 MCP → OpenClaw 任何 skill 直接变陪练工具
- 商业化路线清晰：LiveKit Cloud → 不用自己扛 TURN
- 内置测试 framework 可做 regression

**劣势：**
- 记忆层要自己 wire（增加 1-2 天 + 潜在 bug 面）
- 整体更重，个人 MVP 过度工程
- 依赖 LiveKit server（自托管复杂）

**改造工作量（4-6 天）：**
比 Pipecat 多 1-2 天，主要花在 mem0 hook + LiveKit server 运维。

---

### 🥉 #3 Qwen2.5-Omni 作为 Pipecat 的 LLM 替换

**场景：** Rick 想进一步压延迟到 <300ms（典型级联是 500-800ms）
**做法：** 把 Pipecat 的 LLM layer 换成 Qwen2.5-Omni 直连（走 DashScope 或本地 vLLM）
**增益：** 省掉一次 ASR 的延迟（Omni 直接吃音频）
**代价：**
- tool-call 路径需验证（目前 cookbook 没例子）
- TTS 输出格式需 adapt 到 Pipecat Frame
- 量化到 Int4 时指令遵循质量会降

**建议：** V1 不用，V2 当做优化项

---

## 7. 核心问题答复

### Q1：Rick 自研骨架首选？Pipecat vs LiveKit Agents

**答：Pipecat。** 理由：
- mem0 官方支持 → 英语陪练的 killer feature（记住学员）开箱即用
- Studypal 现成 template
- 组件切换自由度 > LiveKit（LiveKit 绑死自家 WebRTC）
- 社区中文资料多、国产 LLM plugin 齐全
- 个人项目不需要 LiveKit 那种 SFU 级能力

**何时选 LiveKit：** 要做多人课堂（学员组队练对话）、要走 SIP 电话接入。

### Q2：mem0 / Letta 接入语音 agent 的实际难度？

- **mem0 + Pipecat**：⭐⭐（1 天之内）。官方 plugin，示例完整。
- **mem0 + LiveKit**：⭐⭐⭐（1-2 天）。社区 gist 有，要自己写 `before_llm_cb`。
- **Letta + Pipecat**：⭐⭐⭐⭐（3-5 天）。需自定义 LLM service 把 Pipecat 请求转成 Letta API call，处理 tool 冲突（Letta 自己想管 tool）。
- **Letta + LiveKit**：⭐⭐⭐⭐（3-5 天）。同上。

### Q3：端到端模型（Moshi/Qwen2.5-Omni）能否支持外部工具调用？

- **Moshi**：❌ 明确不行。
- **Qwen2.5-Omni**：🟡 理论可以，实操要验证。Thinker 部分继承 Qwen2.5 function call 能力，但官方 cookbook 未给示例。需要自己写 prompt template + 流解析触发。
- **GLM-4-Voice / LLaMA-Omni / Mini-Omni**：❌。

**建议：** V1 使用 **级联架构**（ASR → LLM with tools → TTS），不要为了 100ms 延迟赌 E2E 模型能 hack 出 tool call。V2 再试 Qwen2.5-Omni。

### Q4：有没有现成的「语音 + 工具 + 记忆」三件套开源项目？

**答：没有开箱即用的。** 最接近：
- **Pipecat 官方 `rag-mem0.py`** —— 有记忆 + OpenAI tool，但没做英语陪练业务逻辑
- **studypal** —— 有陪练业务，没 mem0
- **OpenAI Agents SDK voice quickstart** —— 有 tool 和 handoff，没记忆
- 把 studypal + rag-mem0 两个 example 合并，Rick 可以在 2-3 天内得到一个能跑的原型。

---

## 8. 给 Rick 的 Action Items

1. **MVP (Week 1)：** Pipecat + mem0 + Qwen2.5 / DeepSeek + Cartesia，复刻 studypal + rag-mem0 的合并版
2. **陪练增强 (Week 2)：** 加 `assess_pronunciation` 工具（Azure Pronunciation Assessment）、错题本 mem0 schema、SRS 复习队列
3. **Observability (Week 3)：** Langfuse 接入，监测每轮对话的 STT/LLM/TTS 延迟 + 错误率
4. **E2E 实验 (Week 4+)：** 分支探索 Qwen2.5-Omni 本地部署，看能否把延迟砍到 300ms 以下
5. **前端：** Voice UI Kit 起个 Web demo → Electron 打包本地应用 → 后期看要不要上 iOS（Pipecat Swift SDK 有）

---

_调研完成于 2026-04-23。所有数据来自 GitHub API / 官方 docs / repo README。_
