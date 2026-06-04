# Agent Copilot 项目实战复盘

这一页总结 `nwe.md` 里的项目经历，适合回答“你项目怎么做的”“RAG 链路怎么落地”“质量怎么闭环”这类综合追问。

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

5 层闭环：

1. **实时质量评估**：每条回答计算 faithfulness、answer relevance、context precision、context recall 等。
2. **自动降级**：高幻觉时不返回 LLM 生成答案，改为展示原始检索资料和风险提示。
3. **反馈归因**：客服低分反馈后，结合 evaluation log 和 event log 归因到幻觉、检索失败或回答不相关。
4. **监控看板**：Grafana 看聚合指标，Phoenix 看单条 trace。
5. **Eval Harness**：固定测试集 + 质量门禁，模型或参数改动后跑回归。

门禁阈值示例：

| 指标 | 阈值 | 含义 |
| --- | --- | --- |
| `hallucination_high_rate` | ≤ 10% | 客服场景对高幻觉容忍度低 |
| `retrieval_hit_rate` | ≥ 70% | 低于该值说明知识库覆盖不足 |
| `must_include_rate` | ≥ 80% | 关键政策、金额、条款必须命中 |
| `avg_faithfulness` | ≥ 0.7 | 回答大部分内容要能在 context 中找到依据 |

一句话总结：

> 闭环的价值不是完全自动修复根因，而是快速发现问题、降低错误影响、定位原因，并在上线前用评测门禁阻止质量回退。

## 可直接背的项目版回答

> 这个项目是客服 Agent Copilot。架构上我用 LangGraph 把原来 1883 行命令式 orchestrator 拆成 17 个节点和 7 个条件路由，用 StateGraph 维护 30 多个状态字段。知识库侧走 hybrid RAG：文档先按语义边界切分，再做 parent-child，child 用于召回，parent 用于补上下文；检索时 dense 走 pgvector HNSW，sparse 走 tsvector / GIN，RRF 融合后再用 bge-reranker 精排。质量上做了实时评估、幻觉降级、负反馈归因、Grafana/Phoenix 观测和 eval harness 门禁。所以它不是简单的问答 bot，而是一套带人工确认和质量闭环的客服 Copilot。
