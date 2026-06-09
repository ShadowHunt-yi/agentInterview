# 简历追问回答稿

这一页专门用来准备简历上的“熟悉 / 负责 / 提升 / 降低”类追问。回答原则是：**先讲机制，再讲项目落点，最后讲边界和数据口径**。不要把压测、离线评测、预估收益说成真实生产收益。

## 回答总原则

| 面试官关注 | 回答方式 |
| --- | --- |
| 你是不是真懂 | 讲机制、公式、链路，不只背名词 |
| 你是不是做过 | 贴到 `aibotchat` 的模块、表、API、配置、指标 |
| 数字是否可信 | 说明 baseline、评测集、统计口径、是否生产数据 |
| 项目是否落地 | 区分已上线、灰度、实验开关、课程 / 个人项目 |
| 风险是否清楚 | 主动讲失败 case、边界、trade-off |

## 4. RRF 怎么融合 BM25 和向量检索

### 标准回答

RRF，即 Reciprocal Rank Fusion，融合的是**排名**，不是 BM25 分数和向量相似度原始分数。

公式：

```text
RRF_score(doc) = Σ 1 / (k + rank_i(doc))
```

含义：

- `doc`：某个候选 FAQ / chunk。
- `rank_i(doc)`：该 doc 在第 `i` 路检索结果中的排名。
- `k`：平滑参数，常用 60。
- 如果某个 doc 没出现在某一路结果中，那一路不加分。

项目里流程是：

```text
query
→ BM25 / tsvector sparse topK
→ pgvector dense topK
→ 按 chunk_id 合并候选
→ 计算 RRF_score
→ 取 topN 进 bge-reranker-v2-m3
→ parent 内容附着后给 LLM
```

### `k=60` 的直觉

`k` 越小，越强调头部排名；`k` 越大，不同排名之间差距越平滑。

取 `k=60` 的直觉是：不要让 rank 1 对 rank 10 形成压倒性优势，同时仍然奖励靠前结果。

```text
rank 1:  1 / 61 = 0.01639
rank 10: 1 / 70 = 0.01429
```

两者差距约 13%，比较温和。这样一个结果如果在 BM25 和 dense 两路都靠前，通常会超过只在单路排第一的结果。

### 面试官给的排名例子

如果意思是同 3 个文档分别在 BM25 和向量检索里的排名为：

```text
docA: BM25 rank 1, vector rank 2
docB: BM25 rank 3, vector rank 4
docC: BM25 rank 5, vector rank 6
```

取 `k=60`：

```text
docA = 1/(60+1) + 1/(60+2) = 0.03252
docB = 1/(60+3) + 1/(60+4) = 0.03150
docC = 1/(60+5) + 1/(60+6) = 0.03054
```

最终：

```text
docA > docB > docC
```

如果意思是 BM25 返回了三个不同文档，向量检索也返回了三个不同文档，没有交集，那每个文档只拿一路分数：

```text
BM25 rank 1 = 1/61
vector rank 2 = 1/62
BM25 rank 3 = 1/63
vector rank 4 = 1/64
...
```

这种情况下单路 rank 越靠前分越高，但没有“多路共识”加成。

### 项目回答

> 我们没有直接把 BM25 分数和 cosine similarity 相加，因为两者量纲不同。项目里 dense 走 pgvector HNSW，sparse 走 tsvector / BM25 fallback，各自取 topK 后按 chunk_id 做 RRF。这样能让“语义相关”和“关键词命中”都靠前的 FAQ 排到前面，再交给 reranker 精排。

## 5. Function Calling 和 Tool Calling 怎么区分

### 标准回答

它们不是完全不同的东西，而是同一类能力在不同厂商和语境下的叫法。

| 概念 | 含义 |
| --- | --- |
| Function Calling | 更偏 OpenAI 早期叫法：模型输出函数名和参数，应用执行函数 |
| Tool Calling / Tool Use | 更通用：工具可以是函数、检索、代码执行、文件搜索、浏览器、MCP 工具等 |

关键点：**模型不会真的执行函数**。模型只产生结构化调用请求，真正执行工具的是应用或工具服务。

### OpenAI 和 Anthropic 协议区别

| 维度 | OpenAI Function / Tool Calling | Anthropic Tool Use |
| --- | --- | --- |
| 工具声明 | `tools` 参数，`type=function`，参数 JSON Schema | `tools` 参数，name、description、input_schema |
| 模型返回 | `tool_calls`，包含 `id`、function name、arguments | content block 里返回 `tool_use`，包含 `id`、name、input |
| 工具结果回传 | `role=tool`，带 `tool_call_id` | user message 中放 `tool_result` block，带 `tool_use_id` |
| 形态差异 | 更像消息上的工具调用数组 | 更像内容块协议，文本和 tool_use 都是 content block |

项目里可以这样讲：

> 我简历里写 Function Calling / Tool Calling，指的是模型结构化选择工具并输出参数的能力。项目里 LLM 产生 tool call 后，`node_tool_call` 通过 ToolRegistry 找到工具并执行；写工具不会直接执行，而是返回确认卡片，客服确认后才调用 `/tools/confirm/{operation_id}`。

### 和 MCP 的关系

Function Calling 是模型侧协议，解决“模型怎么表达要调用哪个函数”。MCP 是工具侧协议，解决“工具从哪里来、schema 怎么发现、如何跨进程 / 跨服务调用”。

项目里可以串起来：

```text
MCP list_tools()
→ 转成 OpenAI tools schema
→ LLM 输出 tool_call
→ MCPToolProxy 调 MCP Server
→ 返回 ToolInvokeResult
```

## 6. Prometheus / Grafana / Loki / Alertmanager 怎么讲

### Prometheus Pull 模型优势

Prometheus 默认是 pull 模型：Prometheus Server 定期从目标服务 `/metrics` 拉指标。

核心优势：

- 服务发现简单：Prometheus 知道有哪些 target，并统一拉取。
- 监控端可控：采样频率、超时、失败状态都由 Prometheus 统一管理。
- 被监控服务更轻：应用只暴露 metrics，不需要维护推送队列。
- target 存活状态天然可见：拉不到就是 down，不需要额外心跳。
- 适合 Kubernetes / Docker 这类动态服务发现环境。

项目回答：

> 我们的 FastAPI 服务暴露 `/metrics`，Prometheus 定时拉取 HTTP、LLM、RAG、Tool、Quality、Cache 等指标；Grafana 做展示，Alertmanager 做告警路由。

### Loki 和 ELK 的根本区别

| 维度 | Loki | ELK |
| --- | --- | --- |
| 索引理念 | 只索引低基数 labels，不全文索引日志内容 | Elasticsearch 对日志字段建倒排索引 |
| 成本 | 索引小，存储和运维成本低 | 索引重，资源消耗更高 |
| 查询方式 | 先按 label 找 stream，再扫日志内容 | 字段化搜索能力强 |
| 适合场景 | 和 Prometheus 标签体系一致，查服务日志、trace 周边日志 | 复杂全文检索、审计分析、字段聚合 |

为什么项目选 Loki：

> 我们日志主要用于按 service、container、level、trace_id 附近排障，不是做复杂全文检索和安全审计。Loki 和 Prometheus / Grafana 生态一致，部署更轻，成本更低，足够支撑当前 AI 客服系统的日志排障。

边界也要承认：

> 如果后续需要复杂字段检索、长周期审计、海量日志分析，ELK 或 OpenSearch 会更合适。

## 7. Claude Code / Codex 这类 AI 编程工具怎么用

### 比重回答口径

不要说“80% 都是 AI 写的”。更稳的说法：

> 我会把 AI 当成 pair programmer。样板代码、测试用例、文档、重构草案里 AI 参与度较高；核心业务逻辑、架构决策、权限和资金相关代码必须人工主导。我不按代码行数算贡献，更看重需求拆解、review 和验证。

如果必须给比例：

> 在脚手架、单测、文档、重复 CRUD 上，AI 生成初稿可能占 40%-60%；但最终合入代码必须经过我读代码、改代码、跑测试和 review。核心模块的设计和关键实现，我会把 AI 当辅助，不会直接照收。

### 帮助最大的任务

- 生成测试用例和边界 case。
- 梳理旧代码、总结调用链。
- 写文档、README、接口说明。
- 重构重复代码。
- 生成 SQL / migration 初稿。
- 根据报错定位可能原因。

### 不使用或谨慎使用的场景

- 资金、退款、取消订单等高风险写操作。
- 鉴权、权限、数据隔离、安全策略。
- 不了解上下文时的大规模自动重构。
- 需要严格性能证明的底层优化。
- 生产事故中未经验证的“猜测式修复”。

项目回答：

> 在 `aibotchat` 这类项目里，AI 工具适合帮我整理 RAG 链路、生成测试、补文档和做 review checklist；但 HITL 确认、pending operation、租户隔离、工具副作用这些核心边界我会人工设计和审查。

## 8. EBK 工作经历怎么讲技术挑战

### 推荐回答方向

如果简历上 EBK 描述比较笼统，可以选择一个“最像后端工程挑战”的模块讲，例如：

- 酒店库存 / 房态 / 价格同步。
- 订单状态流转。
- EBK 操作日志与审计。
- 商家侧配置变更和灰度。
- 监控和调用链建设。

### 示例回答

> 我独立负责过一个比较有挑战的模块是 EBK 侧酒店房态 / 价格变更链路。难点不是 CRUD，而是状态一致性和可追踪：商家在 EBK 改价格或库存后，下游搜索、订单、渠道展示都要看到正确状态；同时失败要能追溯是哪一步失败。

架构决策可以讲：

- 状态变更先落库，再异步通知下游，保证本系统有事实源。
- 对外调用增加幂等 key，避免重复推送导致库存重复扣减。
- 关键变更写操作日志和审计日志。
- 监控上关注成功率、重试次数、延迟 P95、积压量。
- 对短期失败做重试，对长期失败进入人工处理队列。

如果你的真实模块不是房态价格，把上面的“房态 / 价格”替换成你实际做的 EBK 模块。

## 9. 推动监控和调用链遇到什么阻力

### 可以讲的阻力

- 业务方觉得“功能还没做完，监控不是优先级”。
- 团队担心接入成本高，影响开发节奏。
- 老接口缺少 trace_id，日志格式不统一。
- 指标太多时没人看，告警噪声大。
- 基础设施改动容易影响线上稳定性。

### 落地方式

> 我没有一开始就要求全量改造，而是先从高频接口和线上问题最多的链路做最小闭环：统一 trace_id，关键接口加耗时和错误率指标，日志里带 session/order/request id，再用 Grafana 做一张能排障的看板。

落地步骤：

1. 先接入低侵入中间件，生成 trace_id。
2. 只采集核心指标：QPS、错误率、P95/P99、外部依赖耗时。
3. 给核心链路补结构化日志。
4. Grafana 先做一张业务看板，不追求大而全。
5. 告警先少而准，避免噪声。

## 10. 意图识别 93%，失败的 7% 是什么

### 失败 case 类型

| 类型 | 例子 | 处理 |
| --- | --- | --- |
| 多意图混合 | “帮我取消订单，顺便问下退款多久到账” | 拆分任务或优先识别高风险工具意图 |
| 指代依赖历史 | “那这个还能退吗” | query rewrite 结合历史上下文 |
| 业务词歧义 | “改一下房间”可能是修改订单，也可能是咨询规则 | 进入澄清 |
| 用户表达很短 | “不行”“换一个” | 结合最近轮次，不够就问 |
| 越权 / 敏感 | 夹带内部术语或试探系统 | guard 先于 intent |

### 93% 是否够用

> 如果只是 FAQ 路由，93% 可以作为起点；但如果 intent 会触发取消、退款、修改订单这类写操作，93% 不够直接自动执行。所以项目里高风险工具必须 HITL 确认，低置信度会澄清或转人工。

### 线上投诉率怎么答

如果你没有真实线上投诉率，不要编：

> 当前 93% 是离线标注集 / eval harness 上的准确率，线上我会看低置信路由率、转人工率、负反馈率和工具撤销率。投诉率如果没有独立口径，我不会把它和 intent accuracy 混为一个指标。

## 11. 为什么不用普通 Function Calling，而走 MCP

### 直接回答

普通 Function Calling 能解决“模型选择工具并生成参数”，但解决不了工具生态的标准化治理问题。

MCP 解决的是：

| 问题 | Function Calling | MCP |
| --- | --- | --- |
| 工具发现 | 应用侧手写 tools schema | `list_tools()` 协议发现 |
| 工具部署 | 通常和 Agent 服务耦合 | Server 可独立部署 |
| 工具语义 | 需要应用自定义字段 | annotations 表达 readOnly / destructive / idempotent |
| 多语言接入 | 需要每种语言写适配 | 只要实现 MCP Server |
| 资源 / Prompt | Function Calling 本身不管 | MCP 还支持 resources / prompts |

项目回答：

> 我们默认仍保留进程内 ToolRegistry，因为它低延迟、简单；MCP 是工具远程化和团队协作边界。订单查询这类读工具可以直接执行，取消订单这类 destructive 工具通过 annotation 和业务确认卡片进入 HITL。

## 12. 参数提取 99.2%、响应 1.5s 怎么解释

### 先澄清口径

面试官问得很尖锐，必须先定义：

> 1.5s 如果是参数提取阶段，就只包含意图识别、参数抽取、规则校验和必要的轻量模型调用；不包含完整 RAG + 大模型长答案生成。如果是端到端 P50，需要说明场景是缓存命中、短回答还是流式首包。

建议回答：

> 我的口径是参数提取 / 工具路由链路的平均响应，不等同于复杂 RAG 问答端到端完成时间。完整链路会拆成首 token 延迟、工具返回时间、最终完成时间分别统计。

### 怎么做到快

- 正则快路径处理问候、转人工、明显订单号。
- 分类 + 改写合并为一次小模型调用。
- QueryUnderstandingCache 缓存重复 query。
- 工具参数提取优先走 schema 和规则校验。
- 工具调用和查询类接口尽量并行。

## 13. Top-5 召回 89%，剩下 11% 怎么办

### 评估标准

> 89% 应该说明是离线评测集 Top-5 hit rate：每个 query 标注 expected_doc_codes 或 must-hit FAQ，检索 top5 里出现即算命中。

不要把它直接说成线上真实解决率。

### 11% 失败怎么处理

| 失败原因 | 处理 |
| --- | --- |
| 知识库缺文档 | KnowledgeGapAnalyzer 归因为 retrieval_miss，补 FAQ / SOP |
| query 改写失败 | 加 bad case 到 routing / rewrite eval |
| chunk 切分问题 | 调 chunk / overlap / parent-child |
| dense 不命中精确词 | 提高 sparse 权重或 BM25 召回 |
| 召回低置信 | 展示兜底提示、建议转人工 |

项目回答：

> 未命中不是直接让模型硬答。低置信或无依据时，会走原始资料降级、澄清问题或建议转人工；失败 case 进入质量闭环，用于补知识库和回归评测。

## 14. Rerank 模型、是否真的需要

### 模型回答

项目口径可以说：

> Rerank 用的是 `bge-reranker-v2-m3`。粗召回用 dense + sparse + RRF，reranker 只对 topK × candidate_multiplier 的候选做精排。

### 8000 FAQ 是否需要 rerank

需要做 trade-off，不是绝对需要。

| 不用 rerank | 用 rerank |
| --- | --- |
| 延迟更低，架构简单 | Top 排序更稳，must_include 更好 |
| 适合 FAQ 较短、召回质量高 | 适合 query 和 FAQ 语义接近但细节不同 |
| 可能 top5 命中但 top1/top3 不准 | 能减少给 LLM 的噪声 |

项目回答：

> 8000 FAQ 规模下，召回不难，难的是 top3 排序和上下文噪声。Rerank 的价值不是把 Top-5 hit rate 从 89% 提到很高，而是让真正相关结果更靠前，减少 LLM context 里的干扰。是否开启要看延迟预算：低风险 FAQ 可以关闭，高风险政策/退款类问题开启。

## 15. 双通道投递协议和增量渲染

### 不是普通 Markdown 流

普通 SSE 只流文本；项目里的双通道是：

| 通道 | 内容 | 用途 |
| --- | --- | --- |
| `delta` | Markdown 文本 token | 流式展示解释和回答 |
| `card` | JSON 结构化卡片 | 订单、退款、确认操作、风险提示 |

### 动态拼装

> 文本可以边生成边渲染，但业务卡片不能靠 Markdown 猜。模型或工具返回结构化数据后，后端发 `card` 事件，前端按 card type 增量渲染订单卡、确认卡、风险提示卡。最终 message 落库时，文本进入 content，卡片进入 `content_json.cards`，历史回放时能恢复同样 UI。

这比前端默认 Markdown 解析多做了：

- SSE event type 分流。
- 卡片 JSON schema。
- 操作按钮和 operation_id 绑定。
- 历史回放结构化恢复。
- 工具确认 / 拒绝状态更新。

## 16. token 用量降低 15% 怎么算

### baseline

要先说 baseline：

> baseline 是优化前同一批 eval case / 线上抽样 case 的平均 prompt tokens + completion tokens。优化后在相同 case 集上重跑，对比平均 total tokens。

### 手段

- Query rewrite 后只放相关检索 query，不把冗长历史塞给检索。
- parent-child：child 召回，parent 附着，避免放太多重复 child。
- context 去重：同 parent 只放一次。
- prompt 模板压缩，删除无用 few-shot。
- 历史轮次裁剪，只保留最近 N 轮和必要摘要。
- Answer Cache 命中直接跳过 LLM。

回答：

> 15% 是同一评测集优化前后的 token 统计，不是估计值。主要来自上下文去重、历史裁剪、prompt 压缩和缓存命中。

如果不是严格实测，就改成：

> 这是压测 / 离线评测口径，不是生产财务账单口径。

## 17. 为什么选 Phoenix 而不是 LangSmith / LangFuse

### 对比

| 工具 | 优势 | 边界 |
| --- | --- | --- |
| Phoenix | 开源、适合本地部署、OTLP / trace 分析方便，和 eval 结合好 | 产品化协作能力不如 SaaS |
| LangSmith | LangChain / LangGraph 生态强，调试体验好 | 更偏 LangChain 体系 |
| LangFuse | LLM tracing / prompt / dataset 管理完整 | 需要维护独立平台和数据治理 |

项目回答：

> 我们选择 Phoenix 是因为项目需要自部署、低接入成本、能看单条请求 trace，并且不希望强绑定 LangChain。Grafana 看聚合指标，Phoenix 看单条 Agent/RAG 链路。

### trace 追踪维度

- request / session / message id。
- query understanding 输入输出。
- retrieval topK、分数、doc_code。
- RRF / rerank 前后排序。
- prompt token、completion token、模型耗时。
- tool name、arguments、latency、success。
- HITL pending operation。
- evaluation score、hallucination risk。

定位方式：

| 异常 | trace 能定位 |
| --- | --- |
| 答非所问 | query rewrite / intent 错 |
| 胡编 | retrieval 无命中或 LLM 未使用 context |
| 工具错 | tool args 错、工具失败、确认状态异常 |
| 慢 | embedding、rerank、LLM、工具哪一步慢 |

## 18. 平均处理时长 8 分钟到 2.5 分钟

### 必须说明统计口径

> 这个指标不能混算。要区分总会话时长、人工介入后处理时长、单问题解决时长、Agent 自动处理时长。

稳妥回答：

> 我的口径是客服处理有效问题的平均人工占用时长，不是整个用户会话自然时长。Agent 自动回答和资料卡片减少了客服查资料、复制政策、确认订单信息的时间。

### 避免幸存者偏差

要主动说：

> 如果只统计成功自动处理的会话，会有幸存者偏差。所以应该按全量会话分层看：自动解决、建议转人工、人工接管。8 到 2.5 分钟如果用于简历，应该说明样本范围和统计周期。

## 19. 预计节省 55% 人力成本

### 不能说“裁员”

回答：

> 55% 是理论测算或容量释放，不等于真实裁员比例。客服团队通常不会因为一个系统直接裁到 45%，而是减少新增人力、降低高峰排班压力、提升单客服可处理会话数，把人力转到高价值复杂问题。

体现在哪里：

- AI 自动回答简单 FAQ。
- 工具卡片减少客服查订单时间。
- 建议回复降低新人培训成本。
- 高峰期排队下降。
- 人工只处理复杂和高风险问题。

## 20. LangGraph Supervisor 怎么拆 5 天游

### 子任务拆解

用户说“5 天成都之旅，要有美食和景点”，Supervisor 可以拆成：

1. 需求解析：人数、预算、出发地、住宿偏好。
2. 目的地知识检索：景点、美食、交通、营业时间。
3. 约束检查：季节、节假日、闭馆、交通时间。
4. 行程生成：按天规划路线。
5. 酒店 / 交通 / 门票工具查询。
6. Critic 校验：预算、时间、地理顺路性、约束冲突。
7. 最终整合：输出表格、备选方案、注意事项。

### prompt 还是模型自行推理

> 不是完全让模型自由发挥。Supervisor prompt 里定义可用子 Agent、输入输出 schema、任务拆解原则和停止条件；模型负责根据用户需求选择调用顺序。关键约束用规则和 Critic 校验兜底。

拆错怎么办：

- schema 校验失败重试。
- Critic 发现缺预算 / 缺交通 / 违反闭馆规则时退回重规划。
- 超过重试次数给用户澄清或输出保守方案。

## 21. Qwen3.5 Plus 型号和 1.5 万规则怎么注入

### 型号口径

这个问题要谨慎。现在阿里云百炼官方模型列表会持续变化，公开文档中常见稳定商业名是 `qwen-plus`、`qwen-max`、以及 Qwen3 系列快照；如果简历写 `Qwen3.5 Plus`，面试官可能会追问是否写错。

稳妥回答：

> 这里我会核对实际调用配置。如果线上配置是 `qwen-plus` 或 `qwen-max`，简历应写商业 API 名称，而不是口头写成 Qwen3.5 Plus。我的重点不是型号噱头，而是“用通义千问商业模型做规划推理，并通过 RAG / 规则引擎注入旅行约束”。

### 1.5 万规则怎么管理

不要说全部塞 system prompt。应该说：

```text
规则库
→ 分类：签证、节假日、季节、预算、交通、酒店、景点
→ 向量 / 稀疏检索召回相关规则
→ hard constraints 进校验器
→ soft constraints 进 prompt
→ Critic 验证最终方案
```

回答：

> 硬约束不只靠 prompt，而是结构化规则 + 检索 + 校验器。比如签证、闭馆、节假日属于 hard constraint，不满足就必须重规划；预算、偏好、节奏属于 soft constraint，用于打分和排序。

## 22. MCP 12+ 渠道 Tool 从 8s 到 2.3s

可解释优化：

- 并行调用：酒店、票务、天气、交通独立查询并发执行。
- 工具路由：Supervisor 先判断必要工具，避免所有渠道全查。
- 缓存：城市基础信息、热门景点、静态规则缓存。
- 超时和降级：慢渠道超时后返回备选方案，不阻塞全链路。
- schema 收敛：减少无效参数重试。
- 批量接口：同一城市多个景点合并查询。

回答：

> 8s 到 2.3s 不是 MCP 本身让网络变快，而是工具编排优化：减少不必要调用、并行化、缓存静态信息、对慢渠道设置 timeout 和 fallback。

## 23. Critic Agent 幻觉率从 18% 到 4%

### 幻觉定义

在行程规划里，幻觉不是单一概念，可以分为：

| 类型 | 例子 |
| --- | --- |
| 实体幻觉 | 推荐不存在的酒店 / 景点 / 航班 |
| 约束幻觉 | 推荐闭馆日景点、超预算方案 |
| 时间幻觉 | 交通时间明显不可能 |
| 规则幻觉 | 签证 / 退改 / 门票规则错误 |
| 引用幻觉 | 声称来自某渠道但实际没有检索依据 |

### Critic 也会幻觉怎么办

- Critic 不直接生成最终方案，只做结构化检查。
- 硬约束用规则 / 工具结果校验，不只靠模型判断。
- Critic 输出必须带 violated_constraints。
- 多次不一致时走保守方案或人工确认。

回答：

> Critic Agent 不是权威真相源，它是第二道检查。真正的硬约束来自规则库和工具返回；Critic 负责发现不一致、缺失和潜在冲突。

## 24. 首 token <800ms，25s 到 10s

优化要拆两类：

| 指标 | 优化手段 |
| --- | --- |
| 首 token 延迟 | 先输出规划框架 / 正在查询提示；并行启动工具和检索；模型流式输出 |
| 完整生成时间 | 子任务并行、工具并发、缓存、减少重复 Critic、压缩 prompt |

回答：

> 首 token <800ms 不代表完整行程 800ms 完成，而是用户很快看到可用反馈。25s 到 10s 主要来自并行 Agent / 工具调用、缓存规则和目的地资料、减少无效重试，以及把 Critic 从全量长文本检查改成结构化约束检查。

## 25. “无效方案 51% 降至 82%”这个数字有问题

这题必须主动纠正。

> 这个表述不严谨。51% 降至 82% 是逻辑错误，应该是“有效方案产出率从 51% 提升到 82%”，或者“无效方案率从 49% 降到 18%”。如果简历里写的是“无效方案产出率由 51% 降至 82%”，我会修改。

和幻觉率 4% 的关系：

| 指标 | 含义 |
| --- | --- |
| 幻觉率 | 是否存在事实错误、虚构实体、违反硬约束 |
| 有效方案率 | 是否完整满足用户需求、预算、时间、偏好 |

可能不矛盾：

- 一个方案没有幻觉，但不够好，也可能无效。
- 一个方案符合事实，但路线绕、预算不合适，也算无效。

## 26. 行程规划项目是否真实落地

### 如果是课程 / 个人项目

要坦诚：

> 这个项目是个人 / 课程设计原型，没有真实商业用户。简历里的延迟、首屏可用率、幻觉率是基于自建测试集和压测环境统计，不是线上真实用户数据。

### 数据怎么测

- 首 token 延迟：压测脚本记录 SSE 首个 delta 时间。
- P95 延迟：固定 N 个复杂行程 query 跑并发压测。
- 有效方案率：人工标注测试集 + Critic 辅助判定。
- 幻觉率：实体存在性、时间、预算、规则约束逐项检查。

回答：

> 我会明确区分“线上数据”和“评测 / 压测数据”。如果没有真实用户，就不能说用户量和真实投诉率，只能说在自建 benchmark 上的结果。

## 参考资料

- [OpenAI Function Calling documentation](https://platform.openai.com/docs/guides/function-calling?api-mode=chat)
- [Anthropic Claude Tool Use documentation](https://docs.claude.com/en/docs/tool-use)
- [Prometheus documentation](https://prometheus.io/docs/introduction/overview/)
- [Grafana Loki labels documentation](https://grafana.com/docs/loki/latest/get-started/labels/)
- [阿里云百炼模型列表](https://help.aliyun.com/zh/model-studio/model)
