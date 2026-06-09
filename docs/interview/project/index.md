# Agent Copilot 项目实战复盘

这一页总结 `nwe.md` 里的项目经历，适合回答“你项目怎么做的”“RAG 链路怎么落地”“质量怎么闭环”这类综合追问。

## 内容速查

| 主题 | 入口 |
| --- | --- |
| 项目概述 | [项目一句话](#项目一句话) |
| LangGraph 改造 | [LangGraph 怎么用](#langgraph-怎么用) |
| 条件路由 | [7 个条件路由](#_7-个条件路由) |
| RAG 链路 | [RAG 写入链路](#rag-写入链路) / [RAG 检索链路](#rag-检索链路) |
| 阈值口径 | [关键阈值怎么讲](#关键阈值怎么讲) |
| 质量闭环 | [质量闭环怎么做](#质量闭环怎么做) |
| 消融实验 | [消融实验怎么做](#消融实验怎么做) |
| 工具调用 / MCP | [工具调用和 MCP 怎么落地](#工具调用和-mcp-怎么落地) |
| 架构全景 | [完整项目架构分析](/interview/project/architecture-overview/) |
| 技术决策 | [技术决策与演进边界](/interview/project/architecture-decisions/) |
| 简历追问 | [拷打题回答稿](/interview/project/resume-qa/) |

## 项目一句话

这是一个面向客服场景的 **Agent Copilot**：AI 不直接替代客服，而是辅助客服完成知识问答、订单查询、写操作确认、质量兜底和转人工。

核心链路：

```text
客服输入
→ 敏感检测
→ 意图分类
→ RAG / General / Handoff / Agent 分支
→ LLM 生成或工具调用
→ HITL 确认
→ 质量评估
→ 幻觉降级 / 返回答案
```

## LangGraph 怎么用

项目用 LangGraph 的 `StateGraph` 把原来 1883 行的 orchestrator 单体流程改成图执行引擎。

关键点：

- 拆成 17 个节点。
- 通过 7 个条件路由函数做动态分支。
- 用 `OrchestratorState` 维护 30+ 个中间状态字段。
- 节点函数保持纯函数风格，返回 dict 后由 LangGraph merge 到 state。
- 通过 `_wrap_node` 闭包注入 `GraphServices`，解决节点需要访问 db、llm provider、retriever 等服务的问题。
- `use_langgraph=True` 时走 `chat_with_graph()`，异常时降级到原命令式 pipeline。

可以这样答：

> 我们不是为了追新框架才用 LangGraph，而是因为客服对话链路里有大量条件分支和中间状态。LangGraph 把这些 if/else 变成显式图结构，每个节点可以独立测试，状态也能被 trace 和复盘。

这些数字在面试里要带口径，不要只背：

| 数字 | 说明口径 |
| --- | --- |
| 1883 行 | 原 orchestrator 是单体命令式流程，问题是分支多、状态散、测试困难 |
| 17 个节点 | 按“意图识别、检索、工具调用、确认、质量评估、降级、最终回复”等职责拆分 |
| 7 个路由 | 只处理分支选择，不做业务副作用，方便单测和 trace |
| 30+ 状态字段 | 不是越多越好，核心是把 intent、retrieval、tool、quality、handoff 等中间结果显式化 |

更稳的表达是：我用这些数字说明重构规模，但真正的收益要看可测试性、可观测性、异常降级和后续扩展成本。

## 7 个条件路由

| 路由函数 | 作用 |
| --- | --- |
| `route_after_sensitive` | 敏感拦截后决定结束或继续 |
| `route_after_classification` | 根据 intent 走 handoff / agent / general / knowledge |
| `route_after_cache` | 缓存命中直接返回，否则继续检索 |
| `route_after_llm` | LLM 输出后判断是否进入 tool call |
| `route_after_tool_confirm` | 写工具是否需要 HITL 确认 |
| `route_after_info_completion` | 信息不足时引导补充或继续评估 |
| `route_after_quality_detection` | 高幻觉时降级，否则 finalize |

## 为什么不是多智能体

项目没有做多个 LLM agent 互相协作，而是做 **人机协作 Copilot**。

原因：

- 客服链路核心是理解意图、检索知识、查工具、生成回答。
- 多智能体更适合复杂推理、辩论、规划型任务。
- 客服场景真正复杂的地方在 HITL 确认、质量兜底、转人工和并发安全。

已实现的 agent 相关能力：

- 意图分类路由：knowledge / general / handoff / agent。
- Handoff 状态机：bot → queued → agent_assigned → closed。
- 写操作确认：查询类工具直接执行，写入类工具展示确认卡片，由客服确认后执行。
- 自动转人工：单次高幻觉或连续低质量回答触发建议转人工。

## RAG 写入链路

写入链路按“先保结构，再切分，再向量化，再入库”处理：

1. 文档上传后创建 `KnowledgeDocument`，初始状态为 draft。
2. 切分策略可配置：recursive、parent_child、paragraph。
3. `StructuredChunker` 保留章节路径、表格表头和页码等结构信息。
4. 批量调用 `EmbeddingProvider`，并用 Redis 缓存 embedding。
5. PostgreSQL + pgvector 存 dense embedding。
6. `tsvector` + GIN 索引用于 sparse / full-text 检索。
7. SQLite 作为开发降级方案，只做小规模暴力检索。

切分原则：

> 不优先按固定 token 硬切，而是优先按语义边界切。段落、换行、句号、感叹号这些边界都找不到时，才用滑动窗口兜底。

## RAG 检索链路

检索链路是 hybrid retrieval：

```text
query
→ query embedding
→ dense HNSW 检索
→ sparse GIN / BM25 检索
→ RRF 融合
→ reranker 精排
→ parent 内容附着
→ LLM context
```

关键实现：

- Dense：pgvector HNSW，余弦距离算子 `<=>`。
- Sparse：`search_vector @@ plainto_tsquery`，按 `tsrank_cd` 排序。
- 融合：RRF，默认 `rrf_k = 60`。
- Rerank：`bge-reranker-v2-m3`，过滤低于 0.2 的结果。
- Parent-child：child 用于精准召回，parent 用于提供完整上下文，同 parent 去重。

## 关键阈值怎么讲

| 参数 | 项目值 | 面试解释 |
| --- | --- | --- |
| `chunk_size` | 500 字符 | 贴近文档平均段落长度，兼顾语义完整和匹配精度 |
| `chunk_overlap` | 100 字符 | 约 20%，防止跨块语义断裂 |
| `parent_size` | 1500 字符 | 约 3 个 child，给 LLM 足够上下文 |
| `child_size` | 400 字符 | 语义更聚焦，适合 embedding 检索 |
| `candidate_multiplier` | 3 | topK × 3 进 reranker，平衡召回和延迟 |
| `rerank_threshold` | 0.2 | 过滤明显无关，保留弱相关给 LLM 判断 |
| `MAX_CHUNKS_IN_MEMORY` | 500 | SQLite 降级模式的安全阀 |
| `embedding_cache_ttl` | 7 天 | 覆盖常见文档更新周期，避免 Redis 无限增长 |

阈值不要讲成固定真理。更严谨的说法是：

> 0.2 是初始门槛，最终要通过离线 case 集调。看三个指标：低于阈值的误杀率、进入 LLM 的噪声率、最终答案的 faithfulness。如果业务更怕漏召回，就降低阈值；如果更怕幻觉，就提高阈值或增加无答案降级。

## 为什么选 BGE-M3

选择 BGE-M3 的理由：

- 支持多语言，适合中文、英文、中英混合 SOP。
- 支持 dense、sparse、multi-vector 三种能力。
- dense 维度 1024，和 pgvector HNSW 搭配可接受。
- SiliconFlow 部署成本低，OpenAI 兼容接口方便切换。
- 支持长文本，parent-child 场景下 parent 块也在能力范围内。

追问可以这样答：

> 当前代码主要用 dense embedding，sparse 侧先用 BM25 / tsvector 兜底；BGE-M3 sparse 是后续可以替换 BM25 的优化点。

## 为什么用 LangGraph 不用 LangChain

LangChain 更适合组件封装和线性 chain，LangGraph 更适合有状态、有条件分支的流程编排。

项目里不用纯 LangChain 的原因：

- LCEL 更适合 `prompt | llm | parser` 这类线性链。
- 项目有 7 个条件分支和 30+ 状态字段，需要图结构。
- LangChain Agent 偏 LLM 自主决策工具，而项目需要确定性 pipeline + HITL 确认。
- 自研 retriever 可以直接控制 embedding、HNSW、GIN、RRF、rerank，不被 VectorStore 抽象限制。

## 质量闭环怎么做

闭环不是只记录日志，而是包含检测、归因、降级、可视化和上线门禁。

8 层闭环：

1. **实时质量评估**：每条回答计算 faithfulness、answer relevance、context precision、context recall 等。
2. **自动降级**：高幻觉时不返回 LLM 生成答案，改为展示原始检索资料和风险提示。
3. **反馈归因**：客服低分反馈后，结合 evaluation log 和 event log 归因到幻觉、检索失败或回答不相关。
4. **监控看板**：Grafana 看聚合指标，Phoenix 看单条 trace。
5. **Eval Harness**：固定测试集 + 质量门禁，模型或参数改动后跑回归。
6. **趋势追踪**：QualityTrendTracker 把每次评测写入 `eval_reports`，用滑动窗口判断 improving / stable / degrading。
7. **回归检测**：RegressionDetector 对比最近一次全通过基线，发现 retrieval、hallucination、must_include 等指标回退就告警。
8. **知识库缺口分析**：KnowledgeGapAnalyzer 从失败 case 反推缺文档、embedding 质量问题或检索未命中原因。

门禁阈值示例：

| 指标 | 阈值 | 含义 |
| --- | --- | --- |
| `hallucination_high_rate` | ≤ 10% | 客服场景对高幻觉容忍度低 |
| `retrieval_hit_rate` | ≥ 70% | 低于该值说明知识库覆盖不足 |
| `must_include_rate` | ≥ 80% | 关键政策、金额、条款必须命中 |
| `avg_faithfulness` | ≥ 0.7 | 回答大部分内容要能在 context 中找到依据 |

一句话总结：

> 闭环的价值不是完全自动修复根因，而是快速发现问题、降低错误影响、定位原因，并在上线前用评测门禁阻止质量回退。

面试里可以强调“为什么算闭环”：

```text
检测 → 归因 → 降级/修复 → 可视化 → 门禁 → 趋势 → 回归 → 缺口分析
```

它不只是记录日志，而是能把线上负反馈、离线评测、知识库缺口和上线前质量门禁串起来。真正需要人工修复根因的地方，比如补知识库或改 prompt，也会被归因结果明确指出。

## 消融实验怎么做

消融实验的目的不是证明“我加了很多模块”，而是量化每个模块的边际贡献。

RAG 检索消融可以按 4 个变体逐步加入组件：

| 变体 | 配置 | 看什么指标 |
| --- | --- | --- |
| dense_only | 只用稠密检索 | recall@k、MRR、NDCG |
| dense_rerank | dense + reranker | must_include_rate、top1 precision |
| dense_sparse_rrf | dense + sparse + RRF | retrieval_hit_rate、编号类问题命中 |
| full_pipeline | 加父子切分和 parent 附着 | context_recall、faithfulness |

编排层消融可以关掉部分节点看影响：

| 变体 | 关闭内容 | 看什么指标 |
| --- | --- | --- |
| no_rewrite | 关闭查询改写 | retrieval_hit_rate |
| no_hallucination_degrade | 关闭幻觉降级 | hallucination_high_rate |
| no_info_completion | 关闭信息补全 | 用户补全率、fallback rate |
| full_orchestration | 完整编排 | 全链路质量和延迟 |

实现上用配置覆盖而不是改代码分支：`AblationVariant` 描述变体，`apply_variant()` 深拷贝基础配置并覆盖特定开关，`run_ablation()` 批量跑评测并生成 delta 报告。

面试回答：

> 我做消融不是跑全排列，而是前向加入组件。全排列成本太高，4-6 个关键变体就能看出 dense、sparse、rerank、parent-child、幻觉降级这些组件的主要贡献。如果结果有随机性，同一配置跑多次，用均值和显著性判断是否真的提升。

## 工具调用和 MCP 怎么落地

工具调用做了双模式：默认进程内函数调用，需要隔离和标准化时切到 MCP。

进程内模式：

```text
LLM tool_calls
→ node_tool_call
→ ToolRegistry.get_tool(name)
→ BaseTool.invoke(arguments, db=session)
→ ToolInvokeResult
```

MCP 模式：

```text
LLM tool_calls
→ MCPToolProxy.invoke(arguments)
→ MCP Client
→ MCP Server
→ @mcp.tool()
→ BaseTool.invoke()
→ JSON result
```

为什么引入 MCP：

| 原因 | 解释 |
| --- | --- |
| Tool Discovery | `list_tools()` 暴露工具 schema，Agent 侧不用手写同步 API 文档 |
| ToolAnnotations | `readOnlyHint`、`destructiveHint`、`idempotentHint` 能表达工具副作用和确认要求 |
| 标准化契约 | JSON Schema 作为工具参数契约，方便工具团队独立接入 |
| 渐进式迁移 | `mcp_tool_enabled=false` 走进程内，打开后走 MCP，调用方不用改 |

HITL 确认流不放在 prompt 里，而是由工具声明：

- 查询类工具：`readOnlyHint=True`，可直接执行。
- 写入类工具：`destructiveHint=True`，首次返回确认卡片。
- 客服确认后，再带 `_confirmed=true` 执行真正写操作。

面试里可以这样说：

> MCP 不是替代 OpenAI Function Calling。Function Calling 是模型侧表达“我要调哪个函数”，MCP 是工具侧暴露“有哪些工具、schema 是什么、如何执行”。我们把 MCP schema 转成 OpenAI tools 给模型，模型选工具后，再由 MCP proxy 调真实工具。

## 可直接背的项目版回答

> 这个项目是客服 Agent Copilot。架构上我用 LangGraph 把原来 1883 行命令式 orchestrator 拆成 17 个节点和 7 个条件路由，用 StateGraph 维护 30 多个状态字段。知识库侧走 hybrid RAG：文档先按语义边界切分，再做 parent-child，child 用于召回，parent 用于补上下文；检索时 dense 走 pgvector HNSW，sparse 走 tsvector / GIN，RRF 融合后再用 bge-reranker 精排。工具调用支持进程内和 MCP 双模式，写操作通过 HITL 确认卡片控制副作用。质量上做了实时评估、幻觉降级、负反馈归因、Grafana/Phoenix 观测、eval harness 门禁、趋势追踪、回归检测和知识库缺口分析。所以它不是简单问答 bot，而是一套带人工确认、工具治理和质量闭环的客服 Copilot。

## 参考资料

- [LangGraph documentation](https://langchain-ai.github.io/langgraph/)
- [PostgreSQL full text search](https://www.postgresql.org/docs/current/textsearch.html)
- [pgvector HNSW index](https://github.com/pgvector/pgvector#hnsw)
- [Arize Phoenix documentation](https://docs.arize.com/phoenix)
- [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
