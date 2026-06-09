# 面试题总览

这套文档按面试追问链路拆成 8 个专题。建议先读 RAG 和 LoRA，因为它们最容易被连续追问；再补 Transformer、推理优化、训练对齐、Agent 工程、项目复盘和 Skill/MCP。

## 快速路径

| 专题 | 覆盖问题 | 适合准备 |
| --- | --- | --- |
| [LoRA 微调](/interview/lora/) | 1、2、3、23、24、25、26、29 | 参数、挂载层、适配器尺寸、训练配置 |
| [Transformer 基础](/interview/transformer/) | 4、5、6、7、36、37 | 编码器、解码器、Embedding、Norm、位置编码、BERT/GPT |
| [推理优化](/interview/inference/) | 8、27、28、32 | vLLM、Flash Attention、量化 |
| [RAG 检索增强](/interview/rag/) | 11-20、30、31 | 分块、BGE-M3、混合检索、Milvus |
| [训练与对齐](/interview/alignment/) | 10、21、22 | SFT、RLHF、训练后流程 |
| [Agent 工程](/interview/agent/) | 9、33、34、35 | LangChain/LangGraph、模型选型、评测、文档解析 |
| [项目实战复盘](/interview/project/) | `nwe.md` 项目稿 + 飞书架构分析 | LangGraph、RAG 链路、HITL、质量闭环、架构决策、简历追问 |
| [Skill 与 MCP](/interview/mcp/) | 扩展专题 | Skill 能力包、MCP 协议、工具/资源/提示词、安全 |

## 面试表达模板

回答高频技术题时，尽量用这个顺序：

1. **一句话定义**：先说明它解决什么问题。
2. **关键机制**：讲 2-3 个核心点，不要一上来堆公式。
3. **工程取舍**：说明为什么这么配、速度和效果如何权衡。
4. **项目落点**：把概念落到你项目里的参数、索引、链路或评测。

示例：

> LoRA 的核心是冻结原模型权重，只训练低秩增量矩阵。这样把一个大矩阵的更新拆成两个小矩阵，训练参数量和显存都大幅下降；我一般会把它挂到注意力层的 q/k/v/o projection，必要时再挂 MLP 的 gate/up/down projection，通过 rank、alpha、dropout 控制拟合能力和稳定性。

## 后续新增内容方式

新增题目时优先放到对应专题页。如果一个专题超过 20 道题，再拆成子页，例如 `rag/chunking.md`、`rag/retrieval.md`。导航在 `docs/.vitepress/config.ts` 里维护。
