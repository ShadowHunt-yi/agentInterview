# RAG 检索增强

## Q11. 分块的重叠部分怎么设置

重叠是为了避免重要信息刚好被切在两个 chunk 边界。常见设置：

- 普通知识库：overlap 取 chunk 长度的 10%-20%。
- 结构化文档：按标题、段落、表格边界切，overlap 可以小一些。
- 长依赖文档：适当提高 overlap，但要控制重复召回。

示例：子块 768 token 时，overlap 可从 80-128 token 起步，再通过评测调。

## Q12. 子块长度对检索效果有什么影响

子块太短：

- 语义不完整，embedding 表达不稳定。
- 召回很精确，但给 LLM 的上下文不足。

子块太长：

- 包含多个主题，向量语义被稀释。
- 召回结果看似相关，实际答案位置不突出。

所以 chunk size 是准确率和上下文完整性的平衡。工程上常用父子块：**小块用于召回，大块用于回答**。

## Q13. BGE-M3 的 M 指什么

BGE-M3 中的 M 通常指多能力组合，重点是：

- **Multilingual**：多语言。
- **Multi-granularity**：多粒度，支持短文本到长文档。
- **Multi-functionality**：多功能，支持 dense、sparse、multi-vector 表示。

面试里可以说：BGE-M3 不只是一个普通 dense embedding 模型，它同时支持稠密检索、稀疏检索和多向量检索。

## Q14. 子块长度为什么设为 768 token

768 token 是一个工程折中值，不是硬性标准：

- 比 256/512 更容易保留完整段落和上下文。
- 比 1024/1536 更不容易混入多个主题。
- 对 BGE-M3 这类支持长文本的模型来说，768 在能力范围内。
- 对 reranker 和 LLM context 成本也相对可控。

更严谨的说法：

> 我会把 768 当作初始值，通过检索 hit rate、MRR、answer faithfulness 和人工 case 分析调参，而不是迷信固定长度。

## Q15. 父块一般包含多少子块合适

父块通常包含 3-5 个子块比较稳：

- 太少：上下文补充不明显。
- 太多：返回给 LLM 的内容噪声变多。
- 表格、制度、SOP 类文档可以按一个章节或一个完整业务规则作为父块。

实践上可以让 parent 控制在 1500-3000 token，child 控制在 512-768 token。

## Q16. 稀疏向量和稠密向量怎么检索

| 类型 | 检索方式 | 擅长 |
| --- | --- | --- |
| 稠密向量 | embedding 后做 ANN 近邻搜索，如 HNSW、IVF、DiskANN | 语义相似、同义表达 |
| 稀疏向量 | 词项倒排索引，如 BM25、SPLADE、BGE-M3 sparse | 精确关键词、编号、专有名词 |

稠密检索像“理解意思”，稀疏检索像“命中关键词”。RAG 工程里常把两者融合，避免只靠一种召回。

## Q17. 稀疏和稠密权重怎么设置

两种常见方式：

1. 加权分数融合：`score = α × dense + (1 - α) × sparse`。
2. RRF 融合：只看排名，不直接比较分数。

初始权重可以这样设：

- 通用语义问答：dense 0.6-0.7，sparse 0.3-0.4。
- 编号、政策条款、字段名多：sparse 提高到 0.5。
- 分数不可比或模型来源不同：优先用 RRF。

## Q18. BGE-M3 除了稀疏和稠密还有什么

还有 **multi-vector retrieval**。它不是把整段文本压成一个向量，而是保留多个 token-level 或子向量表示，更适合细粒度匹配。

可以这样答：

> BGE-M3 支持 dense、sparse、multi-vector 三种检索能力。dense 做语义召回，sparse 做词项匹配，multi-vector 提升细粒度交互匹配能力，但工程成本和索引复杂度更高。

## Q19. RAG 链路上怎么提升检索速度

可优化位置：

| 链路 | 优化 |
| --- | --- |
| Query embedding | 缓存高频 query embedding |
| 向量检索 | HNSW / IVF 参数调优，控制 topK |
| 混合检索 | dense 和 sparse 并行查询 |
| Rerank | 只 rerank 粗召回 top 20-50 |
| 上下文构建 | 父块批量查询，去重和裁剪 |
| 服务层 | 连接池、批处理、异步并发 |

关键思路：召回阶段快而宽，重排阶段慢而窄。

## Q20. 为什么不用 rerank 模型代替混合检索

Reranker 通常是 cross-encoder，需要把 query 和每个候选文档拼在一起输入模型。它精度高，但不能直接在全库上跑。

混合检索负责从全库快速找候选，rerank 负责对小候选集精排。两者是上下游关系，不是替代关系。

## Q30. 为什么 RAG 召回比重排快

从模型架构看：

- **Bi-encoder 召回**：query 和 document 分别编码，文档向量可离线预计算；在线只算 query 向量，再做向量近邻。
- **Cross-encoder 重排**：query 和 document 拼接后一起过模型，每个候选都要跑一次前向。

所以 bi-encoder 快、适合全库召回；cross-encoder 慢、适合 topK 精排。

## Q31. Milvus 用什么索引，为什么选 HNSW

HNSW 是图索引，通过多层近邻图做近似最近邻搜索。选择它的理由：

- 召回上限高，调参后质量好。
- 小到中等规模数据速度很快。
- 参数直观：`M` 控制图连接数，`efConstruction` 控制建图质量，`efSearch` 控制查询质量。

取舍：

- HNSW 内存占用较高。
- 数据量极大或强磁盘约束时，可以考虑 IVF、DiskANN 等。

面试话术：

> 我选 HNSW 是因为项目数据规模不算超大，更看重召回质量和调参可控性。它有三档旋钮：M、efConstruction、efSearch，可以在内存、构建时间、召回率和查询延迟之间做平衡。

## RAG 深挖追问排查

### 分块不是越大越好，也不是越小越好

分块本质是在两个目标之间折中：

| 目标 | 倾向 |
| --- | --- |
| 检索精确 | chunk 小，主题单一 |
| 上下文完整 | chunk 大，信息更全 |

如果面试官追问“为什么不用固定 768 token”，要回答：

> 768 只是初始经验值，最终要通过 eval 调。不同文档类型差异很大，制度文档适合按条款，表格适合按表头和行块，FAQ 适合按问答对，代码文档适合按函数或模块边界。

调参指标：

- `retrieval_hit_rate`：是否召回到正确文档。
- `MRR`：正确文档排得是否靠前。
- `context_precision`：召回上下文噪声多不多。
- `faithfulness`：答案是否基于上下文。
- 人工 bad case：看失败是切分、召回、重排还是生成问题。

### overlap 怎么避免重复污染

overlap 能解决跨块断裂，但也会带来重复内容：

- 同一句话可能出现在两个 chunk。
- Rerank 可能把重复 chunk 都排前面。
- LLM context 被重复信息占满，浪费 token。

工程上要做：

- chunk 级去重：相同 text hash 不重复入库。
- parent 级去重：命中多个 child 时，同一个 parent 只放一次。
- context 构建裁剪：按 token budget 控制上下文长度。

一句话：

> overlap 是为了召回不断裂，去重和裁剪是为了上下文不膨胀。

### RRF 为什么适合混合检索

Dense 和 sparse 的分数尺度不一致：

- dense 可能是 cosine similarity。
- sparse 可能是 BM25 / tsrank。
- reranker 又是另一个 relevance score。

如果直接加权，分数很难校准。RRF 只看排名：

```text
score += 1 / (k + rank)
```

好处：

- 不要求 dense 和 sparse 分数同尺度。
- 对 top 排名更敏感。
- 实现简单，稳定性好。

追问回答：

> 如果有大量标注数据，可以学习融合权重；没有足够标注时，RRF 是更稳的工程选择。

### rerank 为什么不能替代召回

Reranker 通常是 cross-encoder，它要把 query 和 document 拼起来一起算：

```text
[query, document] → model → relevance score
```

这意味着它无法对全库每个文档都跑一遍。召回必须先用更快的 bi-encoder / BM25 从全库缩小候选集。

面试要强调：

> 召回解决“从百万文档里找几十个候选”，rerank 解决“从几十个候选里排出最相关的几个”。两者不是替代关系。

### HNSW 三个参数怎么讲

| 参数 | 含义 | 调大影响 |
| --- | --- | --- |
| `M` | 每个节点连接的邻居数 | 召回率更高，内存更多 |
| `efConstruction` | 建图时搜索范围 | 索引质量更高，建图更慢 |
| `efSearch` | 查询时搜索范围 | 召回率更高，查询更慢 |

可以这样答：

> 如果线上发现召回质量不够，优先调大 efSearch，因为它不需要重建索引；如果整体索引质量不够，再考虑调 M 和 efConstruction，但这会增加内存和建图成本。

### BGE-M3 的 three modes 怎么落地

| 模式 | 落地方式 | 成本 |
| --- | --- | --- |
| Dense | 存向量库，ANN 检索 | 工程最常见 |
| Sparse | 存稀疏 token 权重，倒排检索 | 需要 sparse index 支持 |
| Multi-vector | 一个文档多个向量做细粒度匹配 | 精度高但索引和算力成本更高 |

面试里要诚实：

> 如果项目只用了 dense + BM25，也可以说 BGE-M3 sparse/multi-vector 是后续优化方向。不要说已经用了但解释不清怎么存、怎么查。

### RAG 追问清单

| 追问 | 回答要点 |
| --- | --- |
| 检索失败怎么定位？ | 先看 query rewrite，再看召回 topK，再看 rerank，再看 LLM 是否使用 context |
| 为什么答案有上下文还幻觉？ | 可能 context 噪声大、prompt 约束弱、模型没引用证据、答案超出资料 |
| topK 怎么设？ | 召回 topK 可大些，rerank 后给 LLM 的 topK 要受 token budget 控制 |
| hybrid 权重怎么调？ | 关键词强场景提高 sparse，语义问答提高 dense；分数不可靠用 RRF |
| 父子块为什么有效？ | child 保证精确召回，parent 保证上下文完整 |
| 如何评估 RAG？ | 分开评估 retrieval、rerank、generation，不只看最终答案 |
