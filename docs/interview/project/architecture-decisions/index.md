# aibotchat 技术决策、权衡与演进边界

来源：

- [aibotchat 深度架构剖析 — 技术决策、权衡与演进边界](https://k34w0rqi63.feishu.cn/docx/NdMrdyFDToFzWHx4WAhcJgHvnmh)
- [aibotchat AI 客服中台 — 完整项目架构分析](https://k34w0rqi63.feishu.cn/docx/JBq9d7wtKolDAgxsgt7clxDvnEf)

## 文档定位

本文不是整体架构图，而是解释当前架构背后的技术决策：为什么这样拆层，为什么这样做 RAG、缓存、工具、HITL、质量闭环和观测，以及这些选择的边界在哪里。

核心结论：

> 这个项目不是单纯 RAG Demo，而是客服生产系统。架构优先保证“可回复、可追踪、可接管、可审计、可度量”。

## 总体设计思想

客服系统的优先级是：

1. 用户请求必须被接住。
2. AI 回答必须能追踪。
3. 工具操作必须能审计和确认。
4. AI 低质量时必须能降级或转人工。
5. 成本、质量、延迟必须能被度量。

这解释了为什么系统里有大量“外围表”：

- `message_events`
- `tool_call_logs`
- `evaluation_logs`
- `quality_issues`
- `audit_logs`
- `token_usage_logs`

它们不是附属功能，而是让 AI 客服可运营的基础设施。

## 为什么默认采用 Orchestrator

客服对话不是线性流水线。请求会在多个点提前结束：

- 敏感内容命中，直接安全回复。
- 问候或转人工意图，不需要完整 RAG。
- Answer Cache 命中，跳过检索和 LLM。
- 工具调用返回确认卡片，等待人工确认。
- 高幻觉风险，进入原始资料降级或补充信息引导。

如果用简单 Pipeline，每一步都默认继续执行，提前退出和分支会不断污染步骤接口。`ConversationOrchestrator` 用中心协调者维护状态、事件和事务边界，更适合当前复杂分支。

## 为什么不完全交给 Agent Loop

纯 Agent Loop 的问题是不可控：

| 风险 | 在客服场景的后果 | 当前系统的控制方式 |
| --- | --- | --- |
| 工具无限循环 | 成本飙升、响应变慢 | 工具注册表、超时、日志、确认机制 |
| 未确认写操作 | 错误取消 / 退款 / 改订单 | `pending_operations` 二次确认 |
| 幻觉后继续自信回答 | 客诉风险 | 评估器、低质量检测、降级和转人工建议 |
| 决策不可追踪 | 线上排查困难 | `message_events` 逐阶段落库 |

一句话：

> LLM 负责理解与生成，系统负责边界与治理。

## LangGraph 为什么存在但不是默认主路径

代码中有 `use_langgraph` 开关，并存在 `graph_builder.py`、`graph_nodes.py`、`graph_state.py`。这说明项目正在把 Orchestrator 的隐式分支迁移为显式状态图。

LangGraph 的价值：

- 节点边界更清楚，适合复杂条件路由。
- 每个节点可单测、可替换、可观测。
- 高幻觉降级、信息补全、工具确认等流程更适合图表达。

但它不是默认路径也合理：

- 现有 Orchestrator 已经承载生产链路，包括 SSE、卡片协议、缓存、事件、事务等细节。
- 图节点中部分服务接口仍与现有实现不完全等价，需要继续对齐。
- 直接切换可能导致同步 / 流式行为、事件顺序、元数据字段发生差异。

结论：

> LangGraph 是正确演进方向，但当前应作为实验路径逐步替换，而不是一次性重写主链路。

## 为什么 RAG 使用混合检索

酒店 / 商旅客服问题同时包含语义查询和精确实体：

- 语义类：取消政策是什么、能不能退、怎么开发票。
- 精确类：订单号、酒店名、房型、渠道、企业规则、SLA 术语。

纯向量检索对语义泛化好，但对订单号、型号、酒店名等精确 token 不稳定。BM25 / 稀疏检索对精确词强，但对口语化和同义表达弱。因此采用：

```text
Dense 向量召回 + Sparse/BM25 召回
            ↓
         RRF 融合
            ↓
       Reranker 精排
            ↓
       top_k 注入 Prompt
```

## RRF 和 Reranker 为什么要配合

BM25 分数和 cosine similarity 量纲不同。直接加权需要归一化，归一化又依赖每次查询的分数分布。RRF 只看排名，避免分数量纲问题。

但 RRF 也会丢弃原始分数，所以后面需要 Reranker 重新评估 query-document pair 的真实相关性。

这个三段式更容易调试和降级：

- 召回阶段追求覆盖，允许候选冗余。
- 融合阶段解决两路信号尺度问题。
- 精排阶段重新评估真实相关性。

## 为什么保留 pgvector 和 Python fallback

生产环境使用 PostgreSQL + pgvector；测试或无 pgvector 环境使用 Python cosine fallback。

收益：

1. 生产部署保持运维简单，不引入 Milvus / Qdrant 等额外服务。
2. 单元测试不依赖 pgvector 扩展，开发机和 CI 更轻。

边界：

| 规模 | 当前方案是否适合 |
| --- | --- |
| 千级到百万级 chunk | PostgreSQL + pgvector 足够，运维收益高 |
| 千万级向量以上 | 需要评估专用向量库、分区、冷热数据策略 |
| 强多租户隔离 / 超大租户 | 需要租户级索引、分表或独立索引服务 |

## 为什么查询理解合并分类和改写

旧式设计通常是先分类，再改写。当前 `UnifiedClassifier` 选择一次 LLM 调用同时输出 intent 和 search query。

原因是分类和改写天然互相影响：

- “帮我看看这个订单”如果有历史上下文，可能是 tool。
- “这个能退吗”需要历史指代消解，改写后才知道是否是 cancel / refund 知识问题。
- “转人工”“你好”这类强模式不需要 LLM，正则快路径即可。

三层策略：

| 层 | 触发 | 作用 |
| --- | --- | --- |
| 正则快路径 | greeting / handoff / 明显模式 | 0ms，避免无意义 LLM 调用 |
| LLM 统一分类 | 常规复杂查询 | intent + rewritten query 一次完成 |
| 规则 fallback | LLM 超时 / 异常 | 保证主链路不中断 |

配合 Query Understanding Cache，可以避免同一租户、同一问题、同一上下文重复调用小模型。

## 为什么有两级缓存

当前系统有两个昂贵且可复用的阶段：

1. 查询理解：LLM 分类 + 改写。
2. 完整回答：RAG + LLM 生成。

因此缓存分两层：

| 缓存 | 缓存对象 | 命中后跳过 | 风险控制 |
| --- | --- | --- | --- |
| QueryUnderstandingCache | intent、search_query、strategy | 分类 / 改写 LLM | key 包含租户、topic、上下文签名 |
| AnswerCache | 最终回答和元数据 | RAG + LLM 主链路 | 仅 knowledge / general，且 min_hits 达标后写入 |

Answer Cache 不直接缓存所有问题，是为了避免一次性问题污染 Redis。`answer_cache_min_hits=3` 是“频率激活”：只有重复出现的问题才值得缓存。

边界：

- tool / handoff / off_topic 不应缓存，因为工具结果动态，转人工和闲聊没有稳定答案。
- 知识库更新后需要通过租户版本号或 TTL 失效旧答案。
- Redis 不可用时缓存全部 fail-open，性能下降但服务不停止。

## 为什么大量采用 Fail-Open

客服系统的核心 SLA 是“用户能得到响应”。因此 Redis、RAG、Reranker、缓存、Phoenix、成本追踪、质量追踪等增强组件失败时，系统倾向继续主流程。

好处：

- Redis 挂了不导致聊天接口整体 500。
- Reranker 挂了可以退回 RRF / 稠密排序。
- Phoenix 挂了不影响用户回复。
- 成本记录失败不阻断主回答。

但 Fail-open 不等于忽略风险。系统通过这些方式补偿：

- 日志记录 warning / error。
- Prometheus 记录外部服务错误和质量问题。
- 高风险回答触发降级或转人工建议。
- 重要写工具需要确认，不因模型输出直接执行。

边界：如果 Redis 长时间不可用，限流、幂等和会话锁都会失效。生产中必须配置告警，不能只依赖应用日志。

## 为什么写操作要二次确认

工具分为查询类和写操作类：

- 查询类：订单查询、物流查询、入住状态、房量、客史、按客户查订单。
- 写操作类：取消订单、修改订单、申请退款。

写操作通过 `pending_operations` 和 `/api/v1/tools/confirm/{operation_id}` 做二次确认。

关键意义：

> 把“模型建议”和“系统执行”分离，这是 AI 工具系统进入业务生产的必要边界。

## 为什么引入 MCP

当前工具默认是进程内注册，但已经实现 MCP Server / Client。MCP 的意义不是为了赶技术潮流，而是把工具边界从“Python 类调用”升级到“协议调用”。

MCP 带来的价值：

- 工具可以独立部署、独立扩容、独立审计。
- Server 端通过 annotations 暴露 readOnly / destructive / idempotent 语义。
- Client 端仍包装成 `BaseTool` 接口，Orchestrator 不需要知道远端协议细节。
- TraceId 可以通过 HTTP header 继续传播，保证链路追踪不断裂。

当前边界：

- 远程工具的租户上下文、权限、限流还需要进一步产品化。
- MCP 连接失败需要更细的熔断和降级策略。
- 工具 schema 与前端确认卡片仍需要统一规范。

## 为什么 HITL 采用双向约束

系统既不能让用户一进来就绕过 AI，也不能让 AI 连续答错还硬撑。

| 约束 | 当前实现含义 |
| --- | --- |
| 不能随便转 | 至少经历一定 bot 轮次，且有在线坐席，才能主动转人工 |
| 不能一直不转 | 高幻觉风险或连续低质量时，系统建议转人工 |

这里的关键是“建议”而不是“强制”。系统通过 `HANDOFF_SUGGEST_SUFFIX` 提醒用户可以转人工，把最终控制权留给用户或坐席。

## 为什么在线启发式评估 + 离线 Harness 并存

在线每次调用 LLM-as-Judge 成本高、延迟高，不适合生产链路。所以在线评估采用 `HeuristicEvaluator`：通过分词和集合重叠计算五维指标。

| 指标 | 衡量内容 |
| --- | --- |
| faithfulness | 回答是否基于检索上下文 |
| answer_relevancy | 回答是否覆盖用户问题 |
| context_precision | 检索 chunk 是否有用 |
| context_recall | 检索上下文是否覆盖查询 |
| response_relevance | 综合质量分 |

启发式评估的问题是绝对值不够精确，但它成本低、延迟低、可全量运行。离线 Harness 承担更高成本的验证：retrieval、routing、e2e、dialogue、sessions、safety 分层评估，并结合 Phoenix 链路核实、回归检测和知识缺口分析。

结论：

> 在线评估负责实时筛查，离线评测负责版本门禁。

## 为什么事件表是架构中心

`message_events` 同时服务三类需求：

1. 前端和 API 的 `rag-trace` 展示。
2. 线上排障，还原一次请求的阶段链路。
3. Phoenix trace exporter，把内部事件转成 OTel spans。

普通日志是非结构化或半结构化的；`message_events` 是业务结构化事件，带 tenant / session / message / event_seq / payload。

没有事件表，RAG、工具、模型、评估的结果只能靠日志猜。

## 为什么运行时配置可以在线修改

`runtime_settings.py` 允许在线覆盖 LLM、Embedding、Reranker、RAG、安全、缓存、Phoenix、质量等配置。前端设置页直接调用 `/api/v1/settings`。

适合 AI 系统的原因：

- `rag_top_k`
- `rag_score_threshold`
- `rag_rerank_score_threshold`
- `unified_classifier_timeout`
- `answer_cache_min_hits`
- 模型名、base_url、API key

在线配置的风险是错误配置可能即时影响生产流量。因此当前已做 secret masking 和 provider reset，后续还应增加配置校验、审计、回滚和租户级灰度。

## 为什么前端选择单文件控制台

`frontend/index.html` 是一个运维 / 调试控制台，而不是 C 端产品页。

好处：

- 部署简单，Nginx 静态托管即可。
- 与后端 API 快速联调。
- 适合展示聊天、知识库、设置、质量、坐席工作台等管理功能。

代价：

- 状态管理和组件复用会越来越难。
- 质量面板、坐席工作台、知识库管理继续膨胀后，维护成本会上升。
- 后续产品化应迁移到 Vue / React 等组件化前端。

当前阶段它是“工程控制台”的正确选择，但不是长期复杂前端的终局。

## 当前架构的主要风险

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| Orchestrator 与 LangGraph 双路径不完全一致 | 默认链路和实验链路可能产生行为差异 | 建立对照测试，逐节点替换 |
| Redis fail-open 风险 | Redis 故障时限流、幂等、锁和缓存同时失效 | 增加强告警和降级阈值 |
| MCP 远程化边界未完全产品化 | 租户权限、熔断、远程工具审计需要加强 | 为 MCP 增加 auth、tenant context、circuit breaker |
| 质量闭环偏检测，自动修复不足 | 能发现问题，但知识库 / Prompt 修复仍依赖人工 | 增加从 QualityIssue 到修复任务的工作流 |
| 单文件前端后期维护压力 | 功能已接近管理后台 | 组件化重构，拆分 chat / admin / quality / agent 模块 |
| pgvector 扩展上限 | 中小规模合适，超大规模需重新评估 | 提前设计向量分区和迁移接口 |

## 决策矩阵

| 决策点 | 当前选择 | 核心理由 | 边界 |
| --- | --- | --- | --- |
| 主编排 | ConversationOrchestrator | 生产链路成熟，便于事务和 SSE 控制 | 分支复杂，适合逐步迁移 LangGraph |
| 图编排 | LangGraph 实验开关 | 显式状态图适合复杂流程 | 需与默认路径对齐 |
| 检索 | Dense + Sparse + RRF + Reranker | 同时处理语义和精确实体 | 数据量大后需服务化 |
| 向量库 | PostgreSQL + pgvector | 运维简单，事务一致 | 千万级向量需评估专用方案 |
| 查询理解 | 分类 + 改写合并 | 减少调用，分类利用改写语义 | LLM 失败需 fallback |
| 缓存 | Query Cache + Answer Cache | 分别跳过分类和完整回答 | 需租户版本 / TTL 控制一致性 |
| 工具 | ToolRegistry + MCP 可选 | 保持本地简单，同时预留远程边界 | MCP 权限和熔断待加强 |
| 写操作 | pending confirmation | 防止模型直接执行高风险操作 | 需要更完善的审批 UI 和审计 |
| HITL | 双向约束 | 防滥用，也防 AI 硬撑 | 坐席在线能力决定体验 |
| 观测 | message_events + Prometheus + Loki + Phoenix | 结构化事件和指标互补 | 注意敏感数据脱敏 |
| 质量 | 在线启发式 + 离线 Harness | 全量低成本筛查 + 版本门禁 | 启发式绝对分不等于真实质量 |

## 最终结论

`aibotchat` 当前的架构是一个工程治理优先的 AI 客服系统。它没有把 LLM 当作唯一大脑，而是把 LLM 放在一套受控执行环境中：前面有 Guard 和查询理解，中间有 RAG 和工具边界，后面有评估、降级、人工接管、事件追踪、成本和质量闭环。

下一阶段最值得投入的不是再堆更多模型能力，而是把质量闭环和工具远程化边界做得更稳：让问题能自动归因、修复能进入流程、工具能跨服务安全执行，最终形成真正可运营的 AI 客服平台。
