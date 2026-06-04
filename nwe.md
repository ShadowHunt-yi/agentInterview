# Agent Copilot 项目面试问答准备

---

## Q1: 你项目怎么使用 LangGraph 的，干了些什么？

### 核心回答

我们用 LangGraph 的 `StateGraph` 将原来 1883 行的 orchestrator 单体文件重构为**图执行引擎**。整个对话处理流程被拆成 17 个节点，通过 7 个条件路由函数实现动态分支。

**具体做了什么：**

1. **定义状态 TypedDict**（`graph_state.py`）：`OrchestratorState` 包含 30+ 字段，覆盖输入、中间状态、HITL 确认、幻觉降级、输出。所有字段 `total=False`，节点按需读写。

2. **节点函数**（`graph_nodes.py`）：每个节点是 `async (state, services) -> dict` 签名的纯函数。通过 `_wrap_node` 闭包注入 `GraphServices` 容器（包含 db、llm_provider、retriever 等 18 个服务），适配 LangGraph 要求的 `(state) -> dict` 签名。

3. **条件边**（7 个路由函数）：
   - `route_after_sensitive`：敏感拦截 → finalize / 继续
   - `route_after_classification`：意图路由 → handoff / agent / general / knowledge
   - `route_after_cache`：缓存命中 → 直接返回 / 继续检索
   - `route_after_llm`：工具调用 → tool_call / evaluation
   - `route_after_tool_confirm`：需确认 → save_pending / info_completion
   - `route_after_info_completion`：信息不足 → hallucination_degrade / evaluation
   - `route_after_quality_detection`：高幻觉 → hallucination_degrade / finalize

4. **图结构**：request_received → sensitive_check → query_understanding → (分支) → retrieval → context_build → llm_call → tool_call → tool_confirm_check → (分支) → evaluation → quality_detection → finalize

5. **调用方式**：`orchestrator.py` 中 `use_langgraph=True` 时，`chat()` 方法调用 `chat_with_graph()`，通过 `await self._graph.ainvoke(initial_state)` 执行。有 try/except 降级到原命令式 pipeline。

### 追问准备

**Q: 为什么用 StateGraph 而不是 MessageGraph？**
> StateGraph 适合需要跨节点共享复杂状态的场景。我们的 state 不只是消息列表，还包括检索结果、评估分数、HITL 确认状态等 30+ 字段。MessageGraph 只适合纯消息传递的简单链。

**Q: 节点之间怎么传递数据的？**
> 通过 OrchestratorState 的字段。每个节点返回一个 dict，LangGraph 自动 merge 到 state 中。比如 `node_retrieval` 返回 `{"retrieval_results": [...], "rag_confidence": "high"}`，下游节点 `node_context_build` 直接从 state 读取 `state.get("retrieval_results")`。

**Q: 条件边的路由函数怎么写的？**
> 纯函数，读 state 返回字符串。比如 `route_after_sensitive` 就一行：`return "finalize" if state.get("sensitive_blocked") else "query_understanding"`。返回值对应 `add_conditional_edges` 的 mapping dict 的 key。

**Q: 工具调用循环怎么实现的？**
> 原来设计了 `llm_call → tool_call → llm_call` 循环，但现在改为 `llm_call → tool_call → tool_confirm_check → info_completion → evaluation` 的单次工具调用流。写工具需要确认，确认通过 API 回调执行，不再回到 LLM。

**Q: 有没有遇到 LangGraph 的坑？**
> 有。最大的坑是节点函数签名不匹配——LangGraph 要求 `(state) -> dict`，但我们的节点需要访问 db、llm_provider 等服务。解决方案是 `_wrap_node` 闭包，把 services 作为闭包变量注入。另一个坑是 `node_tool_call` 最初调用了不存在的 `tool_registry.execute()` 方法，因为 ToolRegistry 只有 `get_tool()`。

---

## Q2: 有没有多智能体，怎么做的？

### 核心回答

项目**没有**使用 LLM 意义上的多智能体（没有多个 LLM agent 互相协作），而是实现了**人机协作的 Agent Copilot 模式**——AI 辅助人工客服，不是替代。

**我们做了三层"agent"相关能力：**

1. **意图分类路由**（`node_query_understanding`）：
   - 用统一分类器（小模型单次调用）将用户输入分为 4 种意图：knowledge / general / handoff / agent
   - `handoff` 意图 → 转人工队列
   - `agent` 意图 → 预留的专业 agent 分配（当前是 stub）
   - `general` 意图 → 跳过检索，直接 LLM 回答
   - `knowledge` 意图 → 走 RAG 检索流程

2. **人工客服 Handoff 系统**（`handoff_service.py` + `handoff_policy.py`）：
   - 状态机：bot → queued → agent_assigned → closed
   - `HandoffPolicy.check_user_transfer()`：用户主动转人工需满足 4 个条件（HITL 开启、session 状态是 bot、至少 N 轮 AI 对话、有在线客服）
   - `HandoffPolicy.check_auto_handoff()`：自动触发——单次高幻觉或连续 N 次低质量回答
   - `HandoffService.agent_pickup()`：行级条件更新保证并发安全（`current_count < max_concurrent`）

3. **HITL 操作确认**（新实现的 Copilot 模式）：
   - AI 发现需要取消订单 → 查询订单 → 展示确认卡片 → 客服点击确认 → 执行
   - 查询类工具（幂等）直接执行，写入类工具需确认
   - 每个工具通过 `requires_confirmation` 属性自行声明是否需要确认

### 追问准备

**Q: 为什么不做多智能体？**
> 企业内部客服场景不需要多个 AI agent 协作。核心需求是 AI 辅助人，不是 AI 替代人。多智能体适合复杂推理链（如 AutoGen 的 debate 模式），但客服场景的决策链很短：理解意图 → 检索/查工具 → 生成回答。复杂性在于 HITL 确认和质量兜底，不在于 agent 间协调。

**Q: agent 意图路由的 stub 什么时候会实现？**
> 预留了 `node_agent_assign` 节点。未来可以扩展为按客服技能（skills 字段）自动分配专业领域 agent，比如退款问题分配给财务组、技术问题分配给技术支持。但当前优先级是 HITL 确认流。

**Q: Handoff 的并发安全怎么保证的？**
> `agent_pickup()` 使用 SQLAlchemy 的条件更新：`UPDATE agents SET current_count = current_count + 1 WHERE id = :id AND current_count < max_concurrent`。如果 affected rows = 0，说明已满，返回 False。这比先查后改的模式安全，避免了竞态条件。

**Q: 自动转人工的阈值怎么设的？**
> 两个触发器：单次 `hallucination_risk == "high"` 且 `hitl_auto_transfer_on_high_hallucination=True`；或连续 `hitl_consecutive_low_quality_threshold`（默认 2）次低质量回答。都是建议性转人工（suggest_handoff=True），不是强制，会在回答末尾附加提示。

---

## Q3: 知识库怎么处理的？

### 核心回答

完整的 RAG pipeline，分**写入链路**和**检索链路**两条线。

**写入链路（Ingest）：**

1. **文档上传** → 创建 `KnowledgeDocument` 记录（status=draft）
2. **切分**（3 种策略可配置，都基于**语义边界**而非固定 token）：
   - `recursive`（核心）：递归字符切分，按分隔符优先级（`\n\n` → `\n` → `。` → `！` → ... → 空字符串）逐级切，遇到长段落时用滑动窗口（`chunk_overlap` 回退），窗口内优先在句号/感叹号等语义边界处截断，不会在词中间硬切
   - `parent_child`：父子文档切分——复用 `RecursiveChunker` 做两级切分：先按 1500 字符切成 parent 大块，再把每个 parent 按 400 字符切成 child 小块，各级都有独立的滑动窗口 overlap（parent 200 / child 100），保证上下文连续性
   - `paragraph`：段落优先切分，双换行分割，过短合并，过长段落同样走语义边界滑窗
   - **不用固定 token 切分的原因**：固定 token 会把句子切成两半，embedding 语义断裂，检索命中率下降。我们的方案是"先找语义边界，找不到再滑窗"，优先保证每块是一个完整的语义单元
3. **结构化切分**（`StructuredChunker`）：保留章节路径面包屑（如 "第一章 > 第二节 > 定义"），表格按 12 行边界切分保留表头
4. **Embedding**：批量调用 `EmbeddingProvider`（OpenAI 兼容接口），带 Redis 缓存（命中则跳过），验证维度一致性
5. **向量索引**：通过 Alembic 迁移创建——
   - **HNSW 索引**（`vector_cosine_ops`）：对 1024 维 embedding 列建索引，pgvector 默认参数 m=16, ef_construction=64，检索时用 `<=>` 余弦距离算子
   - **GIN 索引**（`tsvector`）：对 `search_text` 列建生成式存储列 `to_tsvector('simple', search_text)`，全文检索用 `@@ plainto_tsquery`
   - SQLite 降级：JSON 存储向量，暴力余弦相似度（O(n)，限制 500 chunks）
6. **写入 DB**：PostgreSQL + pgvector 存储向量，或 SQLite 降级存储

**检索链路（Retrieve）：**

1. **查询 Embedding**：带 Redis 缓存
2. **混合检索**（Dense + Sparse）：
   - PostgreSQL Dense：`embedding <=> query_vec::vector` 走 HNSW 索引，按余弦距离排序取 top_k
   - PostgreSQL Sparse：`search_vector @@ plainto_tsquery` 走 GIN 索引，按 `tsrank_cd` 排序
   - SQLite 降级：暴力余弦相似度（O(n)，限制 500 chunks）+ BM25（jieba 分词）
3. **RRF 融合**：`score += 1.0 / (rrf_k + rank + 1)`，rrf_k 默认 60
4. **Reranker**：SiliconFlow 的 `bge-reranker-v2-m3`，过滤低于 0.2 分的结果
5. **Parent 内容附着**：命中 child chunk 后，批量查询其 parent 内容返回给 LLM（同 parent 去重）

**切分质量保障：**
- 分隔符优先级链（`\n\n` → `\n` → `。` → `！` → ...）保证每块在语义边界截断，不是固定 token
- `min_chunk_size`（默认 100 字符）防止碎片化——过短段落合并回上一块
- `chunk_overlap`（默认 100 字符）保证上下文连续性——滑窗回退时保留重叠区域
- `rag_candidate_multiplier`（默认 3）：检索时取 top_k × 3 候选，rerank 后截取 top_k

**关键阈值推导（面试必问）：**

| 阈值 | 值 | 推导逻辑 |
|------|-----|----------|
| `chunk_size` | 500 字符 | bge-m3 上下文窗口 8192 token，500 字符 ≈ 250-350 token，留足给 system prompt + 历史 + 其他 chunks。太小语义碎片化，太大 embedding 匹配精度下降。经验值，基于知识库文档段落平均长度（300-800 字符）调优 |
| `chunk_overlap` | 100 字符 | chunk_size 的 20%。太少跨块语义断裂，太多冗余 token 浪费 embedding 成本。20% 是业界通用比例（LangChain 默认也是 20%） |
| `min_chunk_size` | 100 字符 | 约 1-2 句话。低于此长度的 chunk embedding 语义太稀疏，检索时噪声大于信号 |
| `parent_size` | 1500 字符 | 约 3 个 child 块大小，给 LLM 提供完整段落上下文。实验发现 >2000 字符会引入无关信息，<1000 上下文不够 |
| `child_size` | 400 字符 | 约 1-2 个段落，embedding 语义聚焦。太小（<200）语义不完整，太大（>600）匹配精度下降 |
| `rrf_k` | 60 | RRF 论文推荐值范围 10-100。k 越大，排名靠后的结果权重衰减越慢。60 是平衡点：top 1 得分 1/61 ≈ 0.0164，top 10 得分 1/71 ≈ 0.0141，差距约 16%，不会让 top 1 垄断 |
| `candidate_multiplier` | 3 | 检索取 top_k×3=15 候选进 reranker。太小（1-2）可能遗漏相关结果，太大（5+）reranker 调用延迟增加（每多 5 条约多 50ms）。3 是精度和延迟的平衡 |
| `rag_rerank_score_threshold` | 0.2 | bge-reranker-v2-m3 的 relevance_score 范围 0-1。实测：无关文档得分 <0.05，部分相关 0.2-0.5，高度相关 >0.6。0.2 过滤掉明确无关的，保留"可能相关"的给 LLM 判断。太低（0.1）噪声多，太高（0.4）会丢失间接相关的知识 |
| `faithfulness < 0.2 → high` | 0.2 | 启发式评估中 faithfulness = answer 和 context 的 token overlap 率。0.2 意味着回答中只有 <20% 的内容能在检索结果中找到依据，基本是"凭空编造"。0.2-0.4 是 medium（部分有依据），>0.4 是 low（基本有据可查） |
| `retrieval confidence` | 0.7/0.4 | top_score 来自 RRF 融合后的归一化分数。≥0.7 表示 dense 和 sparse 一致认为高度相关；0.4-0.7 部分匹配；<0.4 可能检索失败 |
| `hallucination_high_rate ≤ 10%` | 36 条中 ≤3 条 | 客服场景容忍度低——10 条回答有 1 条高幻觉就会失去客服信任。10% 是上线底线，低于此说明模型+知识库整体可靠 |
| `retrieval_hit_rate ≥ 70%` | 36 条中 ≥25 条命中 | 知识库覆盖率指标。低于 70% 说明知识库有大量缺口，需要补充文档而非调优检索 |
| `must_include_rate ≥ 80%` | 回答必须包含的关键信息 | 评测用例中标记了 must_include 关键词（如退款金额、政策条款），80% 是 QA 团队可接受的最低标准 |
| `table split ≤ 12 行` | 表格行数阈值 | 12 行 × 平均 50 字符/行 ≈ 600 字符，接近 chunk_size。超过此长度的表格语义上需要分段，但必须保留表头保证每段可独立理解 |
| `embedding cache TTL` | 7 天 | embedding 模型不变的情况下向量不变。7 天覆盖了大部分文档更新周期，同时避免 Redis 内存无限增长。文档更新时通过删除 chunk 触发重建 |
| `MAX_CHUNKS_IN_MEMORY` | 500 | SQLite 降级模式的安全阀。500 chunks × 1024 维 × 4 字节 ≈ 2MB 向量数据，加上文本内容约 5-10MB 内存，开发机可承受 |
| `hitl_consecutive_low_quality_threshold` | 2 次 | 连续 2 次低质量（high 幻觉或未使用检索上下文）说明 AI 在该话题上不可靠，建议转人工。1 次太敏感（误触发），3 次用户体验差（已经忍受了 3 次差回答） |
| `hitl_min_bot_rounds` | 3 轮 | 防止用户一开始就转人工（浪费 AI 资源）。3 轮对话足够 AI 尝试回答，也足够用户判断 AI 是否能解决问题 |

### 追问准备

**Q: 为什么用 RRF 融合而不是单独用向量检索？**
> 单独向量检索有两个问题：一是对精确关键词匹配不擅长（比如搜"订单号 24120717"这种精确串），二是对中文分词场景支持弱。BM25 擅长精确匹配但不懂语义。RRF 融合两者优势：dense 负责语义相似，sparse 负责关键词匹配，rank-based 融合避免了分数尺度不一致的问题。

**Q: 父子切分的好处是什么？滑动窗口怎么做的？去重呢？**
> 解决"切小了丢上下文，切大了不精确"的矛盾。Child 小块（400 字符）用于检索匹配，提高精度；命中后返回 Parent 大块（1500 字符）给 LLM，保证上下文完整。类似 Google 的 snippet + full page 模式。滑动窗口是复用 RecursiveChunker 的机制——先按分隔符优先级（双换行 > 换行 > 句号 > ...）找语义边界，找不到才用 chunk_overlap 字符回退做滑窗截断。Parent 和 Child 各有独立的 overlap（200/100），不会出现固定 token 切分把句子切断的问题。去重：检索时 top_k 个 child 可能命中同一个 parent，如果直接拼入 context 会重复浪费 token。`_format_rag_block` 用 `seen_parent_ids` 集合跟踪已出现的 parent_id，同一 parent 只保留第一次出现的内容，后续 child 跳过。

**Q: 为什么不用固定 token 切分？**
> 固定 token 切分有两个致命问题：一是语义断裂——一句话被切成两半后，embedding 向量既不代表上半句也不代表下半句的语义，检索时两头都匹配不上；二是中文没有天然空格分词，token 边界可能落在词中间，导致 embedding 质量下降。我们的方案是"语义边界优先，滑窗兜底"——RecursiveChunker 先按分隔符链找段落/句子边界，只有当一个段落本身超过 chunk_size 时才启动滑窗，滑窗内也会优先在句号处截断。

**Q: Reranker 的作用是什么？为什么不在检索阶段就过滤？**
> 检索阶段（dense + sparse）是粗筛，速度快但精度有限。Reranker 是精排，用交叉编码器（cross-encoder）对 query-document pair 做精细打分，精度高但速度慢。所以先粗筛取 top_k × 3 候选，再 rerank 精排到 top_k。过滤阈值 0.2 的推导：bge-reranker-v2-m3 的 relevance_score 范围 0-1，实测无关文档 <0.05，部分相关 0.2-0.5，高度相关 >0.6。0.2 过滤掉明确无关的噪声，保留"可能相关"的给 LLM 判断。太低（0.1）噪声多浪费 token，太高（0.4）会丢失间接相关的知识。

**Q: Embedding 缓存怎么做的？**
> Redis 缓存，key 是 `emb:{model}:{text_hash}`，TTL 默认 7 天。`_embed_texts()` 先批量查缓存，只对 miss 的文本调用 API。这样重复文档或相似查询不会重复计费。

**Q: SQLite 降级的暴力检索性能怎么样？**
> 有限制：`MAX_CHUNKS_IN_MEMORY = 500`，只加载最近的 500 个 chunks 到内存。超过后需要 PostgreSQL。SQLite 降级主要用于本地开发和演示，生产环境必须用 PostgreSQL + pgvector。

**Q: 向量索引用的什么？为什么选 HNSW？**
> pgvector 的 HNSW 索引，算子类 `vector_cosine_ops`，默认参数 m=16, ef_construction=64。选 HNSW 而不是 IVFFlat 的原因：HNSW 不需要提前知道数据量（IVFFlat 需要训练聚类中心），支持增量插入（新文档 embedding 写入后立即可检索，不需要重建索引），检索精度更高（recall > 99%）。缺点是内存占用稍大，但我们的数据量（万级 chunks）完全不是问题。全文检索用的是 GIN 索引，对 `search_text` 列建生成式 tsvector 列，两条索引路径独立，最后通过 RRF 在应用层融合。

---

## Q4: 为什么用 LangGraph 不用其他的，不用 LangChain？

### 核心回答

**选择 LangGraph 的原因：**

1. **状态管理是刚需**：我们的 pipeline 有 30+ 中间状态字段（检索结果、评估分数、HITL 确认状态、幻觉降级标记等），需要跨节点共享和修改。LangGraph 的 `StateGraph` 天然支持 TypedDict 状态 + 自动 merge，比手动传参或全局变量干净。

2. **条件分支是刚需**：7 个条件路由（敏感拦截、意图分类、缓存命中、工具确认、信息补全、幻觉检测、质量检测），每个都是运行时动态决定。LangGraph 的 `add_conditional_edges` 比 if/else 链更声明式，图结构可序列化、可可视化。

3. **可观测性**：LangGraph 内置 checkpoint 机制，每步状态可序列化。配合 Phoenix OTel trace 导出，可以精确看到每一步的输入输出、耗时、分支决策。

4. **HITL 天然支持**：LangGraph 的 `interrupt` 机制（虽然我们最终用了更简单的 API 回调模式）和 human-in-the-loop 设计理念与 Agent Copilot 场景高度契合。

**不用纯 LangChain 的原因：**

1. **LangChain 的 LCEL（LangChain Expression Language）是线性链**：`chain = prompt | llm | parser` 这种 pipe 模式适合简单的 prompt → LLM → 输出 场景，但不适合有 7 个条件分支的复杂编排。

2. **LangChain 过度抽象**：太多层封装（BaseRetriever → VectorStoreRetriever → ...），调试时要穿透 5-6 层才能看到实际逻辑。我们更喜欢直接控制——比如 retriever 就是自己写的 `KnowledgeRetriever`，直接调 embedding API + 数据库查询，不用 VectorStore 抽象层。

3. **LangChain 的 Agent 模式不适合我们**：LangChain 的 Agent 是"LLM 自主决策调用哪些工具"，我们的场景是"确定性 pipeline + 条件分支"，不需要 LLM 自己决定下一步做什么。

**但保留了 LangChain 的部分**：
- 用了 `langgraph` 包（依赖 `langchain-core` 的一些类型定义）
- 没有用 `langchain` 主包的 chain、agent、retriever 抽象

### 追问准备

**Q: 如果不用 LangGraph，你会怎么做？**
> 原来就是命令式 pipeline——在 `_handle_message()` 里用 if/else 串联 19 个步骤。1883 行，难维护、难测试、难加新分支。LangGraph 把它变成声明式图定义 + 纯函数节点，每个节点可独立单元测试。

**Q: LangGraph 的性能开销大吗？**
> 有开销但可接受。每次图执行有状态序列化/反序列化成本（TypedDict → dict merge），但相比 LLM 调用（100ms-5s）和检索（50-500ms），图执行本身的 overhead < 1ms。瓶颈永远在 I/O（LLM、DB、Redis），不在图引擎。

**Q: 有没有考虑过自己写 DAG 引擎？**
> 考虑过。但 LangGraph 已经解决了：状态管理、条件路由、错误处理、checkpoint 这些通用问题。自己写的话至少 2 周工作量，还不包括测试。用 LangGraph 可以专注业务逻辑。

**Q: LangGraph 版本升级有没有踩坑？**
> 从 0.2 到 0.4 有 breaking change：`add_conditional_edges` 的 mapping 从 list 改为 dict。我们直接用的 0.4+，没踩这个坑。但要注意 LangGraph 迭代很快，API 不稳定。

---

## Q5: 为什么选择 bge-m3？

### 核心回答

选择 `BAAI/bge-m3` 基于 4 个技术考量：

1. **多语言支持**：我们是企业内部客服系统，知识库有中文文档、英文技术文档、中英混合的 SOP。bge-m3 支持 100+ 语言，一个模型搞定，不需要区分中英文用不同 embedding 模型。

2. **稠密 + 稀疏一体化**：bge-m3 同时输出 dense embedding（语义向量）和 sparse embedding（稀疏向量）。我们的混合检索（dense + sparse + RRF 融合）正好需要这两种表示。虽然当前代码只用了 dense，但架构上已经为 sparse 预留了位置。

3. **性价比**：通过 SiliconFlow 部署，bge-m3 的 embedding 调用是免费的（cost_price_config 中配置为 $0）。对于企业内部场景，每天可能有上千次检索，零成本 embedding 很关键。

4. **长文本支持**：bge-m3 支持最大 8192 token 的输入。我们的 chunk_size 默认 500 字符，远在限制内。但对于 parent_child 模式，parent 块 1500 字符也没问题。

**技术指标：**
- 向量维度：1024（dense），可配置
- MTEB 中文榜单排名靠前
- 支持 OpenAI 兼容 API 格式，通过 SiliconFlow 或自部署均可

### 追问准备

**Q: 有没有和其他 embedding 模型对比过？**
> 对比过 text-embedding-3-small（OpenAI）和 m3e-base（国产）。
> - text-embedding-3-small：英文强但中文弱，且有 API 费用
> - m3e-base：中文不错但不支持多语言，且需要自部署 GPU
> - bge-m3：中文强 + 多语言 + 免费部署 + OpenAI 兼容 API → 最终选择

**Q: 为什么不自己部署 embedding 模型？**
> 企业内部场景对延迟要求不高（embedding 调用 50-200ms 可接受），SiliconFlow 的免费 tier 足够。自部署需要 GPU 服务器，运维成本高。如果未来数据量大到 SiliconFlow 限流，可以用 vLLM/TGI 自部署同一模型，API 接口兼容，切换成本低。

**Q: bge-m3 的 sparse embedding 你用了没？**
> 当前代码只用了 dense embedding。sparse embedding 的集成需要在 retriever 的 `_sparse_search` 方法中调用 bge-m3 的 sparse 输出，替换当前的 BM25 分词。这是一个已规划的优化点，优先级不高因为 RRF 融合 + reranker 已经能保证检索质量。

**Q: 向量维度 1024 会不会太大影响检索性能？**
> PostgreSQL + pgvector 用 HNSW 索引，1024 维的检索延迟在 10-50ms（百万级数据）。SQLite 降级是暴力检索，维度影响大但有 500 chunks 上限保护。如果需要降维，bge-m3 支持 Matryoshka 表示，可以截取前 256/512 维。

---

## Q6: 项目流程是怎么样的？

### 核心回答

**用户视角的完整流程：**

```
客服输入 → 敏感词检测 → 意图分类 → [分支]
  ├─ general: 直接 LLM 回答
  ├─ knowledge: 缓存查询 → [命中直接返回 / 未命中] → RAG 检索 → Rerank → 上下文构建 → LLM 生成
  ├─ handoff: 转人工队列
  └─ agent: 分配专业客服
  
LLM 回答后 → 工具调用检测 → [有工具调用]
  ├─ 查询工具: 直接执行 → 信息补全检测 → [信息不足→引导补充 / 充足] → 质量评估
  └─ 写入工具: 展示确认卡片 → 客服确认 → 执行 → 质量评估

质量评估 → 幻觉检测 → [高幻觉→降级展示原始资料 / 正常] → 质量问题检测 → 返回回答
```

**技术栈分层：**

```
┌─────────────────────────────────────────────┐
│  Frontend (index.html)                       │
│  SSE 实时流 / 确认卡片 / 质量仪表盘          │
├─────────────────────────────────────────────┤
│  API Layer (FastAPI)                         │
│  /chat, /tools/confirm, /quality, /knowledge │
├─────────────────────────────────────────────┤
│  Orchestration (LangGraph StateGraph)        │
│  17 节点 + 7 条件路由                        │
├─────────────────────────────────────────────┤
│  Services                                    │
│  LLM Provider │ Retriever │ Reranker │ Eval  │
│  Tool Registry │ Handoff │ Quality Detector  │
├─────────────────────────────────────────────┤
│  Data Layer                                  │
│  PostgreSQL+pgvector(HNSW)+tsvector(GIN)     │
│  Redis(缓存) │ SQLite(开发降级)              │
├─────────────────────────────────────────────┤
│  Observability                               │
│  Phoenix OTel │ Prometheus │ Grafana         │
└─────────────────────────────────────────────┘
```

**一次典型的知识问答流程（最常见路径）：**

1. 客服输入："杭州西湖酒店的取消政策是什么？"
2. `node_request_received`：记录事件，初始化计时
3. `node_sensitive_check`：通过
4. `node_query_understanding`：统一分类器（小模型单次调用）→ intent=knowledge, search_query="杭州西湖酒店 取消政策"
5. `node_answer_cache_lookup`：Redis 查询缓存 → miss
6. `node_retrieval`：embedding 查询 → HNSW 索引余弦检索（pgvector `<=>` 算子）+ GIN 索引全文检索（`tsvector @@ tsquery`）→ RRF 融合 → Reranker 精排 → 返回 top 5 chunks
7. `node_context_build`：格式化 RAG context block
8. `node_llm_call`：构建 messages（system prompt + RAG context + 用户问题 + 历史轮次）→ 调用 LLM
9. `node_evaluation`：HeuristicEvaluator 计算 5 维分数 → 幻觉风险判定
10. `node_quality_detection`：正则检测内部信息泄露、高延迟等
11. `node_finalize`：组装最终回答 + 元数据

**一次典型的写操作流程（HITL）：**

1-5 同上
6. `node_retrieval`：检索订单信息
7-8. LLM 判断需要取消订单 → 返回 tool_call
9. `node_tool_call`：调用 `cancel_order` 工具 → 返回 `pending_confirmation=True` + 确认卡片
10. `node_tool_confirm_check`：检测到需确认
11. `node_save_pending_operation`：持久化到 DB，返回确认卡片
12. `node_finalize`：返回给客服确认界面
13. 客服点击确认 → `POST /tools/confirm/{operation_id}` → 执行取消 → 返回结果

### 追问准备

**Q: 为什么 SSE 而不是 WebSocket？**
> SSE（Server-Sent Events）是单向服务端推送，适合"客服输入 → 等待 AI 回答"这种请求-响应模式。WebSocket 是双向的，适合实时聊天。我们的场景是客服和 AI 1:1 对话，不需要双向实时通道。SSE 更简单、更好做负载均衡（HTTP 无状态）、更容易配合 nginx 反代。

**Q: 统一分类器是什么？为什么一次调用能同时分类和改写？**
> 用一个小模型（默认 gpt-4o-mini）在一次 LLM 调用中同时完成意图分类和查询改写。Prompt 设计为 JSON 输出格式：`{"intent": "knowledge", "search_query": "杭州西湖酒店 取消政策"}`。比分开调用两次 LLM 节省一半延迟和 token。

**Q: 历史轮次怎么传给 LLM 的？**
> `prompt_builder.build_messages()` 从 DB 查询 session 的历史消息（最多 `llm_max_context_rounds` 轮），构建 OpenAI 格式的 messages 数组。RAG context 放在 system prompt 中，用户历史放在 messages 中。

**Q: token 怎么追踪的？**
> `TokenTracker` 在每次 LLM 调用后记录 prompt_tokens、completion_tokens、total_tokens。写入 `token_usage_logs` 表，同时更新 Prometheus 指标 `LLM_TOKENS`。用于成本计算和用量监控。

---

## Q7: 怎么闭环的，为什么认为你闭环了？

### 核心回答

闭环是指**质量问题能被自动发现、归因、修复、验证**，而不是只停留在"检测到问题"。我们的闭环有 5 层：

**第 1 层：实时质量评估（每条回答）**
- HeuristicEvaluator 计算 5 维分数（faithfulness, answer_relevancy, context_precision, context_recall, response_relevance）
- 幻觉风险自动判定：faithfulness < 0.2 → high risk（faithfulness 是回答和检索上下文的 token overlap 率，<0.2 意味着回答中 <20% 有依据，基本是凭空编造）
- 双重触发：context_recall < 0.15 且回答 >50 字符也判定 high（检索到了但回答完全没用上）
- 结果写入 `evaluation_log` 表 + Prometheus 指标

**第 2 层：自动检测与降级（Graph 节点）**
- `node_quality_detection`：正则检测内部信息泄露（TMC、工单号、SOP 等关键词）
- `node_hallucination_degrade`：高幻觉时自动降级——不返回 LLM 生成的回答，改为展示原始检索资料 + 风险提示
- `node_info_completion`：信息不足时引导客服补充信息

**第 3 层：用户反馈归因（Feedback Loop）**
- 客服打 1-2 分负反馈 → `FeedbackAnalyzer` 自动归因
- 查询该消息的 evaluation_log + event_log
- 推断原因：幻觉 / 检索失败 / 回答不相关
- 生成 `QualityIssue` 记录（issue_type, severity, details）

**第 4 层：质量仪表盘（Grafana + 前端）**
- 5 个 Grafana dashboard（47 panels）：RAG overview、LLM performance、Embedding/Reranker、Quality Evaluation、Infrastructure
- 前端质量子标签：问题列表、反馈分析、评估报告、成本追踪
- 3 条 Prometheus 告警规则：内部信息泄露（critical）、检索失败率突增、负反馈率突增

**第 5 层：评测门禁（Eval Harness）**
- 36 条测试用例覆盖：精确查询、模糊查询、知识问答、边界情况
- `QualityGate` 6 个门禁：must_include_rate ≥ 80%、hallucination_high_rate ≤ 10%、retrieval_hit_rate ≥ 70% 等
- `run_eval --save-report` 自动生成评测报告存入 DB
- 支持版本对比（report_a vs report_b）

**为什么说闭环了：**

```
检测 → 归因 → 降级/修复 → 可视化 → 预防
  │        │        │          │        │
  │        │        │          │        └─ eval gate 拦截上线前质量
  │        │        │          └─ Grafana + 前端仪表盘
  │        │        └─ 幻觉降级 + 信息补全引导
  │        └─ 负反馈自动归因到 QualityIssue
  └─ 每条回答实时评估 + 正则检测
```

关键区别于"只检测不闭环"的系统：
- 不是只记录日志——有自动降级和引导补全
- 不是只看指标——有负反馈归因到具体 issue
- 不是只事后分析——有 eval gate 事前拦截

### 追问准备

**Q: 负反馈归因的准确率怎么样？**
> 当前是规则归因（非 LLM），准确率有限但速度快、零成本。规则包括：hallucination_risk=high → 归因为幻觉；retrieval_hit=False → 归因为检索失败；其他 → 归因为回答不相关。未来可以升级为 LLM-as-judge 归因。

**Q: 幻觉降级会不会影响用户体验？**
> 会，但这是权衡。对 Agent Copilot 场景，客服需要的是准确信息而非流畅但可能错误的回答。降级后展示原始资料，客服可以自行判断。如果客服觉得降级过度，可以通过负反馈触发归因，调整阈值。

**Q: 评测门禁的阈值怎么定的？**
> 基于 36 条测试用例的初始评测 + 业务容忍度：
> - `hallucination_high_rate ≤ 10%`：客服场景容忍度低，10 条有 1 条高幻觉就失去信任。36 条中 ≤3 条是上线底线
> - `retrieval_hit_rate ≥ 70%`：低于 70% 说明知识库有大量缺口，需要补文档而非调优检索
> - `must_include_rate ≥ 80%`：QA 团队标记的关键信息（退款金额、政策条款等）必须出现，80% 是最低标准
> - `avg_faithfulness ≥ 0.7`：平均每条回答 70% 以上内容有检索依据，整体可靠
> 所有阈值通过 `runtime_settings` API 可热更新，不需要重启。评测用例也会随知识库更新持续补充。

**Q: Grafana 47 个 panels 会不会太多了？**
> 5 个 dashboard 按职责分离：RAG、LLM、Embedding/Reranker、Quality、Infrastructure。每个 dashboard 8-12 个 panels，oncall 看 Infrastructure 和 Quality，算法看 RAG 和 LLM。不会全部打开。

**Q: Phoenix 和 Grafana 的区别是什么？**
> Grafana 看聚合指标（QPS、延迟 P95、错误率），Phoenix 看单条 trace 的完整链路（这次请求经过了哪些节点、每步耗时、检索了哪些 chunks、LLM 返回了什么）。两者互补：Grafana 发现问题 → Phoenix 定位具体哪条请求出问题。

**Q: 闭环的最后一环——修复——你做了吗？**
> 自动修复做了两件事：幻觉降级（不返回错误回答）和信息补全引导（告诉客服需要补充什么）。但真正的"修复根因"（比如更新知识库、调整 prompt）还是人工的。这是合理的——自动修复根因需要理解业务语义，当前 AI 做不到。闭环的价值在于**快速发现 + 减少影响 + 辅助定位**，不是完全自动修复。
