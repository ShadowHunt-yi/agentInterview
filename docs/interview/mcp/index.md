# Skill 与 MCP 深度剖析

## 内容速查

| 主题 | 入口 |
| --- | --- |
| Skill 是什么 | [能力包和工作流](#skill-是什么) |
| MCP 是什么 | [协议架构](#mcp-是什么) |
| Tools / Resources / Prompts | [三类 primitive](#mcp-的三类核心-server-能力) |
| Skill vs MCP | [核心区别](#skill-和-mcp-的核心区别) |
| 生产风险 | [安全风险](#mcp-安全风险) |

这一页回答两个容易混淆的问题：

- **Skill 是什么**：给 Agent 的“能力包 / 工作流说明 / 专业操作手册”。
- **MCP 是什么**：让 AI 应用连接外部工具、数据和提示模板的标准协议。

一句话区别：

> Skill 偏“怎么做事”的方法论和流程封装；MCP 偏“怎么连接外部能力”的协议和接口标准。Skill 可以指导模型如何使用工具，MCP 可以把工具、资源和 prompt 暴露给模型。

## Skill 是什么

在 Agent 工程里，Skill 通常是一组可复用的能力说明，包含：

- 触发条件：什么时候应该使用这个能力。
- 操作流程：按什么步骤完成任务。
- 约束规则：哪些事情不能做，哪些必须确认。
- 参考材料：领域知识、模板、示例。
- 可选脚本：把复杂操作封装成可执行工具。

可以把 Skill 理解成：

```text
Agent 的领域操作手册
```

它不是模型参数，也不是一个外部 API。它更像“把经验沉淀成结构化说明”，让 Agent 在遇到特定任务时少走弯路。

## Skill 解决什么问题

没有 Skill 时，Agent 每次都要临场理解：

- 这个任务属于什么领域。
- 应该先查什么。
- 哪些信息必须验证。
- 哪些操作有风险。
- 输出格式应该是什么。

Skill 把这些经验提前固化，收益是：

| 问题 | Skill 的作用 |
| --- | --- |
| Prompt 每次写很长 | 把领域流程沉淀为可复用文档 |
| Agent 行为不稳定 | 固定触发条件和执行步骤 |
| 新人经验难复制 | 把专家经验变成操作手册 |
| 多工具调用容易乱 | 规定工具顺序、输入输出和校验 |
| 安全边界不清楚 | 写明禁止事项和确认流程 |

面试里可以说：

> Skill 本质是 Agent 的可复用操作知识，不直接提供外部能力，而是告诉模型在某类任务里应该如何思考、调用哪些工具、如何校验结果和如何输出。

## 一个 Skill 通常怎么设计

一个好的 Skill 至少包含这些部分：

```text
name
description
trigger
workflow
constraints
tool usage
examples
fallback
```

设计原则：

1. **触发要明确**：不要写“任何时候都可用”，否则会误触发。
2. **步骤要可执行**：不要只写理念，要写先做什么后做什么。
3. **边界要清楚**：涉及删除、支付、退款、发消息等动作要明确确认。
4. **输出要有格式**：让 Agent 知道最后交付什么。
5. **失败要有 fallback**：工具失败、权限不足、信息缺失时怎么处理。

## MCP 是什么

MCP，全称 Model Context Protocol，是一个开放协议，用来标准化 AI 应用和外部工具 / 数据源之间的连接。

官方架构里有三个核心参与者：

| 角色 | 含义 |
| --- | --- |
| MCP Host | AI 应用，例如 IDE、桌面助手、Agent 平台 |
| MCP Client | Host 内部维护连接的客户端组件 |
| MCP Server | 提供工具、资源、提示模板的服务 |

一个 Host 可以连接多个 MCP Server。每个 Server 可以暴露自己的能力，例如：

- 文件系统 server。
- 数据库 server。
- GitHub server。
- Jira / Confluence server。
- 浏览器或自动化 server。

MCP 用 JSON-RPC 2.0 做数据层协议，传输层可以是本地 `stdio`，也可以是远程 Streamable HTTP。

版本口径要说清楚：早期 MCP 远程传输常见的是 HTTP + SSE；较新的规范里推荐 Streamable HTTP。面试时不要把“协议是什么”和“某个版本的传输实现”混在一起，可以这样说：

> MCP 的稳定核心是 Host / Client / Server 架构，以及 tools、resources、prompts 这些 primitive；传输层会随规范演进，本地常用 stdio，远程新规范更强调 Streamable HTTP。

## MCP 的三类核心 Server 能力

MCP Server 主要向 Client 暴露三类 primitive：

| Primitive | 是什么 | 举例 |
| --- | --- | --- |
| Tools | 可执行函数，让模型做动作 | 查数据库、创建 issue、调用 API |
| Resources | 可读取上下文数据 | 文件内容、数据库 schema、文档列表 |
| Prompts | 可复用提示模板 | 代码审查模板、旅行计划模板 |

三者不要混：

```text
Tool = 让模型做动作
Resource = 给模型读资料
Prompt = 给模型一个工作模板
```

### Tools

Tool 是最像传统 API 的东西，但它要给模型使用，所以必须有清晰 schema：

- 工具名。
- 描述。
- 输入参数 JSON Schema。
- 返回内容。
- 是否有副作用。
- 权限和确认要求。

工具设计的关键不是“能不能调通”，而是“模型能不能理解什么时候该调、怎么传参、调完怎么用结果”。

### Resources

Resource 是上下文数据，不一定要模型主动执行动作。比如：

- `file:///project/README.md`
- `db://schema/orders`
- `wiki://hotel/cancel-policy`

Resource 更像“可浏览、可选择、可注入上下文的资料”。

如果把资源都做成 tool，会导致模型每次都像在执行动作；如果把动作都做成 resource，又无法表达副作用。

### Prompts

Prompt 是模板，不是工具。它可以引导用户或模型使用某组 tools/resources。

例如一个“分析数据库问题”的 prompt 可以要求：

1. 先读取 schema resource。
2. 再调用 query tool。
3. 最后按固定格式总结。

Prompt 通常由用户显式调用，而不是模型自动乱触发。

## Skill 和 MCP 的核心区别

| 维度 | Skill | MCP |
| --- | --- | --- |
| 本质 | 能力说明 / 工作流 / 操作手册 | 标准协议 / 外部能力接口 |
| 关注点 | 模型应该怎么做 | 模型怎么连接工具和数据 |
| 是否执行代码 | 本身不一定 | Tool 可以执行代码或 API |
| 是否标准协议 | 通常不是统一协议 | 是协议规范 |
| 典型内容 | 流程、约束、示例、模板 | tools、resources、prompts、transport |
| 风险点 | 指令过宽、触发不准、流程过时 | 权限、数据泄漏、工具注入、副作用 |

一句话：

> Skill 是 Agent 的“方法”，MCP 是 Agent 的“接口”。Skill 可以告诉 Agent 怎么用 MCP 暴露出来的工具。

## Skill 和 MCP 怎么配合

一个完整 Agent 可以这样组织：

```text
用户任务
→ Skill 判断任务类型和执行流程
→ MCP 暴露可用工具和资源
→ Agent 按 Skill 调用 MCP tools/resources
→ 校验结果
→ 输出答案或请求人工确认
```

例子：排查线上接口 500。

| 阶段 | Skill 做什么 | MCP 做什么 |
| --- | --- | --- |
| 识别任务 | 判断是日志排查 | 提供日志 server |
| 收集上下文 | 规定先看错误日志再看请求链路 | 暴露 `search_logs` 工具 |
| 分析 | 要求按时间线和服务维度归因 | 暴露 trace / metrics resource |
| 输出 | 固定输出根因、证据、修复建议 | 返回结构化查询结果 |

## MCP 调用链路

MCP 工具调用不是模型直接执行代码，而是：

```text
LLM 产生 tool call
→ Host 拦截
→ Client 找到对应 MCP Server
→ Server 执行 tool
→ Client 收到结果
→ Host 把结果放回对话上下文
→ LLM 基于结果继续回答
```

关键点：

- LLM 只提出调用意图。
- Host / Client 负责路由和权限。
- Server 负责真实执行。
- 用户或 Host 应该控制高风险操作。

## MCP 和 Function Calling 有什么区别

Function Calling 是模型 API 层的工具调用格式。MCP 是工具和上下文的连接协议。

| 对比 | Function Calling | MCP |
| --- | --- | --- |
| 层级 | 模型接口层 | 应用集成协议层 |
| 作用 | 让模型输出结构化 tool call | 让工具/资源/提示模板被发现和调用 |
| 工具来源 | 通常由应用手写注册 | 来自一个或多个 MCP Server |
| 范围 | 偏单次模型调用 | 偏完整工具生态连接 |

可以这样答：

> Function Calling 解决“模型怎么表达要调用函数”，MCP 解决“这些函数、资源、提示模板从哪里来、怎么发现、怎么连接、怎么执行”。

## MCP 和 RAG 有什么关系

RAG 是一种“检索外部知识再生成”的应用模式。MCP 是连接外部工具和资源的协议。

二者可以结合：

- MCP Resource 暴露文档、schema、知识库条目。
- MCP Tool 执行搜索、向量检索、数据库查询。
- Agent 把检索结果放入上下文，再生成答案。

所以：

```text
RAG 是应用链路
MCP 是连接方式
```

## MCP 安全风险

MCP 的能力强，是因为它能连接真实系统；风险也来自这里。

主要风险：

| 风险 | 说明 | 防护 |
| --- | --- | --- |
| 数据泄漏 | resource 可能包含敏感信息 | 最小权限、资源白名单、用户确认 |
| 工具误调用 | LLM 误判意图调用高风险 tool | HITL、工具分级、dry-run |
| Prompt injection | 外部资源里夹带恶意指令 | 内容隔离、引用标注、不要盲从 resource 指令 |
| Tool poisoning | 恶意 server 或工具描述诱导模型 | server 白名单、签名、审计 |
| Confused deputy | 模型借用户权限做越权事 | 权限绑定、操作确认、审计日志 |
| Secret 暴露 | 工具返回 token、密钥或内部路径 | 输出过滤、敏感字段脱敏 |

面试里可以说：

> MCP Server 不是越多越好。生产环境要做 server 白名单、权限隔离、工具分级、用户确认和审计日志，否则 Agent 接上工具后风险会成倍放大。

## 怎么设计一个 MCP Server

设计步骤：

1. 明确服务边界：这个 server 只负责什么领域。
2. 先定义 resources：哪些数据只读暴露。
3. 再定义 tools：哪些动作可以执行。
4. 工具 schema 写清楚：参数、枚举、必填、返回格式。
5. 标注副作用：查询、写入、删除、支付、发消息要分级。
6. 加权限控制：不同用户能调用不同工具。
7. 加审计：记录谁在什么时候调用了什么工具，参数是什么。
8. 加错误语义：不要只返回 “failed”，要告诉模型可恢复方式。

一个好的工具描述应该回答：

```text
这个工具做什么？
什么时候应该用？
什么时候不应该用？
输入参数怎么填？
返回结果怎么解释？
是否有副作用？
是否需要用户确认？
```

## Skill 设计反例

坏 Skill：

```text
遇到问题时尽量解决，必要时调用工具。
```

问题：

- 触发条件太泛。
- 没有步骤。
- 没有安全边界。
- 没有输出标准。

好 Skill：

```text
当用户要求排查服务错误时：
1. 先确认服务名、时间范围、环境。
2. 读取最近错误日志。
3. 按 trace_id 聚合请求链路。
4. 只读查询可直接执行，重启/删除/修改配置必须请求确认。
5. 输出：现象、证据、根因假设、下一步建议。
```

## 面试追问清单

| 追问 | 回答要点 |
| --- | --- |
| Skill 和 MCP 最大区别？ | Skill 是方法论，MCP 是协议接口 |
| MCP 的 Host/Client/Server 是什么？ | Host 是 AI 应用，Client 维护连接，Server 提供上下文和能力 |
| Tools 和 Resources 区别？ | Tool 做动作，Resource 提供可读上下文 |
| Prompts 是不是 prompt engineering？ | 是可复用模板，但在 MCP 里是可发现、可参数化的 server primitive |
| MCP 是否等于 Function Calling？ | 不等，Function Calling 是模型调用格式，MCP 是工具生态连接协议 |
| MCP 是否等于 RAG？ | 不等，RAG 是应用模式，MCP 可以提供 RAG 所需资源和检索工具 |
| 生产 MCP 最大风险？ | 权限、数据泄漏、工具副作用、prompt injection、恶意 server |
| Skill 怎么避免失控？ | 明确触发条件、步骤、边界、确认流程和 fallback |
| MCP Server 怎么做权限？ | server 白名单、用户身份透传、工具级权限、审计日志 |
| 什么时候用 Skill，什么时候用 MCP？ | 流程知识用 Skill，外部工具/数据连接用 MCP |

## 可直接背的回答

> Skill 和 MCP 不是一类东西。Skill 是 Agent 的操作手册，告诉模型遇到某类任务时应该怎么做、按什么步骤做、有哪些约束；MCP 是连接外部工具和数据源的协议，定义 Host、Client、Server，以及 tools、resources、prompts 等能力。实际项目里可以用 Skill 规定工作流，再通过 MCP 暴露数据库、日志、文件、API 等工具和资源。生产上重点是权限、确认、审计和防 prompt injection，不能把所有工具无脑接给模型。

## 参考资料

- [MCP Architecture overview](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP Server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts)
- [MCP Specification 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18)
- [MCP Transports 2025-06-18](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)
