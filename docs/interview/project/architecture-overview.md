# aibotchat 完整项目架构分析

来源：

- [aibotchat AI 客服中台 — 完整项目架构分析](https://k34w0rqi63.feishu.cn/docx/JBq9d7wtKolDAgxsgt7clxDvnEf)
- [aibotchat 深度架构剖析](https://k34w0rqi63.feishu.cn/docx/NdMrdyFDToFzWHx4WAhcJgHvnmh)

## 一句话定位

`aibotchat` 是一个面向酒店 / 商旅客服场景的多租户 AI 客服中台。它以 FastAPI 为服务入口，以 PostgreSQL + pgvector 和 Redis 为状态与缓存基础，以 RAG + Function Calling / MCP 工具为智能回答核心，并通过 HITL、质量检测、成本追踪、Prometheus / Grafana / Loki / Phoenix 形成生产闭环。

这不是一个简单聊天 Demo，而是一个可观测、可降级、可人工接管的客服执行系统。

## 能力全景

| 维度 | 当前实现 |
| --- | --- |
| 后端 | Python 3.13、FastAPI、SQLAlchemy 2.0、Alembic |
| 数据 | PostgreSQL / pgvector、Redis |
| AI | OpenAI-compatible Chat、BAAI/bge-m3 Embedding、BGE Reranker |
| 编排 | 默认 ConversationOrchestrator，实验开关支持 LangGraph |
| 工具 | 进程内 ToolRegistry，或 MCP Tool Server / Client |
| 前端 | 单页 HTML / CSS / JS 控制台，Nginx 容器托管 |
| 观测 | Prometheus、Grafana、Alertmanager、Loki、Promtail、Phoenix OTLP |
| 评测 | retrieval、routing、e2e、dialogue、sessions、safety 六层 Harness |

## 启动链路

`app/main.py` 的 `lifespan` 是系统启动枢纽：

1. 读取 `Settings`，初始化日志。
2. 如果 `APP_AUTO_CREATE_TABLES=true`，执行 `init_db()` 并补齐种子数据。
3. 初始化 `ConnectionManager`，注入 WebSocket 模块。
4. 初始化 Redis；Redis 不可用时系统继续运行，但限流、锁、幂等、Embedding Cache、Answer Cache 降级。
5. 如果 `MCP_TOOL_ENABLED=true`，在同一 FastAPI 进程内挂载 `/mcp`，启动 MCP session manager，并预加载工具列表。
6. 注册 CORS、中间件、API 路由和异常处理。
7. 如果 `PROMETHEUS_ENABLED=true`，暴露 `/metrics`。

关键判断：PostgreSQL 是核心持久化依赖；Redis、MCP、Phoenix、Reranker 等属于增强能力，失败时以降级方式保护主流程。

## 后端分层

| 层 | 目录 / 模块 | 职责 |
| --- | --- | --- |
| API 层 | `app/api/v1` | HTTP / SSE / WebSocket 接口，参数校验，依赖注入 |
| Core 层 | `app/core` | 配置、鉴权、中间件、异常、敏感词、指标、运行时设置 |
| Service 层 | `app/services` | 对话编排、RAG、LLM、工具、HITL、质量、成本、观测 |
| Data 层 | `app/db/models`、`app/db/repositories` | SQLAlchemy 模型和 Repository 数据访问 |
| Schema 层 | `app/schemas` | API 请求 / 响应模型 |
| Eval 层 | `app/eval`、`app/scripts` | 分层评测、质量门禁、回归分析 |
| Frontend | `frontend/index.html` | 控制台、聊天调试、知识库、设置、质量、坐席面板 |
| Ops | `docker-compose*.yml`、`monitoring` | 容器编排、监控、日志、告警 |

## API 能力版图

| 能力 | 入口 |
| --- | --- |
| 健康检查 | `GET /api/v1/health`、`GET /api/v1/health/dependencies` |
| 会话 | `POST/GET /api/v1/sessions`、关闭、删除 |
| 对话 | `POST /api/v1/chat`，支持同步和 SSE |
| SSE 续传 | `GET /api/v1/chat/resume?message_code=&last_seq=` |
| 历史消息 | `GET /api/v1/sessions/{code}/messages` |
| 事件追踪 | `GET /api/v1/sessions/{code}/events`、`rag-trace` |
| 知识库 | 文档创建、上传、索引、重建、删除、列表、详情 |
| HITL | 转人工、坐席接入、释放、坐席发消息、排队列表 |
| 工具确认 | `POST /api/v1/tools/confirm/{operation_id}`、reject、pending |
| WebSocket | `/api/v1/ws/customer`、`/api/v1/ws/agent` |
| 反馈与质量 | feedbacks、evaluation、quality overview/issues/trend/report |
| 成本 | cost summary、session cost |
| 配置 | runtime settings 在线读取、更新、重置 |
| 管理配置 | agents、welcome-menu、canned-responses |

## 对话主链路

```text
用户消息
→ 会话与消息落库
→ 敏感检测
→ 查询理解 / 意图分类
→ RAG / General / Handoff / Agent 分支
→ 检索 / 工具调用 / LLM
→ HITL 确认或质量评估
→ 幻觉降级 / 信息补全 / 最终回答
→ message_events / evaluation_logs / metrics
```

主链路有几个重要工程点：

- 用户消息先 `flush()`，最终再 `commit()`，保证事务内可见并减少中间提交。
- SSE 事件带序号，并写入 Redis 5 分钟，支持断点续传。
- 卡片采用双通道协议：文本走 `delta`，结构化数据走 `card`，历史回放依赖 `content_json.cards`。
- `ConversationOrchestrator` 是默认稳定路径；`use_langgraph=true` 时切到图编排实验路径。

## RAG 架构

| 阶段 | 当前实现 |
| --- | --- |
| 文档解析 | TXT / MD / PDF / DOCX / CSV / XLSX / JSON 等文件解析为结构化 block 或文本 |
| 切片 | `TextChunker`、`StructuredChunker`、可选 `ParentChildChunker` |
| 向量化 | 批量 embedding，Redis EmbeddingCache 减少重复计算 |
| 稠密检索 | PostgreSQL + pgvector，测试或无 pgvector 时 Python fallback |
| 稀疏检索 | PostgreSQL sparse search 或 Python BM25 fallback |
| 融合 | RRF，`rag_rrf_k=60`，`rag_candidate_multiplier=3` |
| 精排 | SiliconFlow BGE reranker，可关闭，失败退回 RRF / 稠密分数 |
| 置信度 | low / confident 阈值驱动兜底、警示或正常注入 Prompt |

RAG 的重点已经从“能检索”升级到“结构化解析、混合召回、精排、父子切分、缓存、评估、观测”全链路。

## 工具调用、MCP 与确认流

工具体系有两种运行模式：

| 模式 | 触发配置 | 说明 |
| --- | --- | --- |
| 进程内 ToolRegistry | `mcp_tool_enabled=false` | 默认模式，直接注册 Python `BaseTool` |
| MCPToolRegistry | `mcp_tool_enabled=true` | 通过 `/mcp` 协议暴露和调用工具，支持远程化边界 |

默认业务工具包括订单查询、物流查询、取消订单、修改订单、申请退款、入住状态、房量价格、客史查询、按客户查订单。

读工具通过 `readOnlyHint=True` 标记为幂等查询；写工具通过 `destructiveHint=True` 标记为需确认操作。写工具首次执行可返回 `pending_confirmation=True` 和确认卡片，系统写入 `pending_operations`，再由 `/api/v1/tools/confirm/{operation_id}` 二次确认后真正执行。

这个设计把 Function Calling 从“模型直接调用工具”升级成“模型提出操作，系统审计和人工确认后执行”。

## HITL 人机协同

| 路径 | 机制 |
| --- | --- |
| 用户主动转人工 | `HandoffPolicy.check_user_transfer` 检查轮次、会话状态、在线坐席 |
| 系统建议转人工 | 高幻觉风险或连续低质量回答时追加建议，而不是强制中断 |

会话状态核心是：

```text
bot -> queued -> agent_assigned -> closed
```

REST API 提供排队、接入、释放；WebSocket 提供客户与坐席实时消息通道。前端控制台中也有坐席工作台，支持上线、队列刷新、接入会话和坐席回复。

## 数据模型

当前模型共 22 张业务 / 观测表，分为 7 组：

| 分组 | 表 |
| --- | --- |
| 租户与接入 | `tenants`、`channels`、`users` |
| 会话与消息 | `sessions`、`messages`、`message_events` |
| 人工客服 | `agents`、`welcome_menu_items`、`canned_responses` |
| 知识库 | `knowledge_documents`、`knowledge_chunks` |
| 工具与酒店业务 | `tool_call_logs`、`pending_operations`、`hotel_orders`、`hotel_guests`、`hotel_refunds`、`room_inventory` |
| 质量与反馈 | `feedbacks`、`evaluation_logs`、`quality_issues`、`eval_reports` |
| 安全与成本 | `audit_logs`、`token_usage_logs` |

迁移历史说明项目已经从“聊天 MVP”演进到“可运维的客服中台”。

## 质量闭环

质量体系有在线和离线两条线：

| 线 | 组件 | 作用 |
| --- | --- | --- |
| 在线实时 | `HeuristicEvaluator` | 每次回复计算 faithfulness、answer relevancy、context precision/recall、response relevance |
| 在线检测 | `QualityDetector` | 检测内部信息泄露、幻觉、高延迟、检索失败、低质量 |
| 在线展示 | `QualityDashboard` API + 前端 | 展示问题数、严重程度、趋势、评测报告、chunk 质量 |
| 离线评测 | `app/eval` | retrieval / routing / e2e / dialogue / sessions / safety 分层测试 |
| 闭环分析 | `RegressionDetector`、`KnowledgeGapAnalyzer` | 发现质量回归和知识库缺口 |

`message_events` 是质量链路的中枢。它记录 request、query understanding、retrieval、tool call、LLM、evaluation 等事件，并被 `/rag-trace` 聚合，也可导出到 Phoenix。

## 可观测性与成本

| 类型 | 实现 |
| --- | --- |
| HTTP 指标 | 请求量、延迟、错误率 |
| LLM 指标 | 调用次数、延迟、token |
| RAG 指标 | 检索次数、耗时、结果数、低置信度 |
| Tool 指标 | 工具调用次数、耗时、失败 |
| Cache 指标 | Answer Cache、Query Understanding Cache 命中 / 存储 |
| Quality 指标 | 评估次数、评估分布、质量问题 |
| 成本 | `CostCalculator` + `CostTrackingService`，按模型 / token / 会话聚合 |
| Trace | TraceIdMiddleware + message_events + Phoenix OTLP |
| 日志 | Promtail 采集容器日志到 Loki |

注意：代码中 Phoenix 是当前 trace exporter 的主路径；文档中若仍出现 Langfuse，应视为历史部署说明或可选旧路径，不是当前主实现。

## 部署架构

主 `docker-compose.yml` 包含：

| 服务 | 端口 | 说明 |
| --- | --- | --- |
| app | 8000 | FastAPI 后端 |
| frontend | 3000 | Nginx 静态前端 |
| postgres | 5432 | PostgreSQL + pgvector |
| redis | 6379 | 缓存、锁、幂等、SSE 续传 |
| prometheus | 9091 | 指标采集 |
| grafana | 3001 | 仪表盘 |
| alertmanager | 9093 | 告警路由 |
| loki | 3100 | 日志存储 |
| promtail | - | Docker 日志采集 |

`docker-compose.external-db.yml` 支持复用外部 PostgreSQL / Redis；`docker-compose.phoenix.yml` 提供单容器 Phoenix trace UI。主网络固定在 `10.246.0.0/24`，避免与常见内网 / VPN 网段冲突。

## 测试与评测资产

自动化测试覆盖 API 与服务层：auth、chat、sessions、knowledge、messages、metrics、health、feedbacks、tool calling、guard、retriever、chunker、embedding、evaluator、context manager、query router、prompt builder、Phoenix client 等。

评测数据集包括：

- `hotel_qa.jsonl`
- `hotel_routing.jsonl`
- `hotel_dialogues.jsonl`
- `hotel_sessions.jsonl`
- `hotel_safety.jsonl`

评测层包括 retrieval、routing、e2e、dialogue、sessions、safety，可用于 RAG 调参、路由验证、端到端质量门禁和安全回归。

## 当前架构判断

当前项目已经具备生产型 AI 客服中台的骨架：多租户、会话状态、RAG、工具、人工协同、质量评估、缓存、成本、观测和部署都已经在代码中闭合。

清晰的演进方向：

1. LangGraph 路径仍是实验开关，默认 Orchestrator 仍是事实主干，后续需要统一两条链路的行为和事件语义。
2. MCP 已经建立边界，但默认工具仍是本地注册；如果要多服务化，需要补齐鉴权、租户上下文传递和远程故障隔离策略。
3. 质量检测已经能发现问题，但从 `QualityIssue` 到自动修复知识库 / Prompt 的闭环仍需要更多工作流支持。
4. pgvector 适合当前中小规模知识库，向千万级向量扩展时应规划专用向量服务或分库索引策略。
5. Redis fail-open 保护可用性，但真实生产环境仍应对限流、会话锁和幂等缺失设置明确告警与降级阈值。

## 面试总结

> `aibotchat` 的架构核心是“一个可观测、可降级、可人工接管的 AI 客服执行系统”。RAG、工具调用和 LLM 只是其中的智能组件；真正的工程价值在于把这些能力放进租户隔离、会话状态、消息事件、工具审计、质量检测、成本归因和部署监控的闭环里。
