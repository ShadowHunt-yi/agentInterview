# 推理优化

## Q8. vLLM 的原理理解吗

vLLM 主要解决大模型在线推理时的吞吐和显存利用问题。核心是 **PagedAttention**：把 KV Cache 像操作系统分页一样管理，不要求一段请求的 KV 在显存里连续存放。

传统推理的问题：

- 不同请求长度不同，KV Cache 容易碎片化。
- 为最大长度预分配显存会浪费。
- batch 中请求生成长度不同，调度效率低。

vLLM 的做法：

- KV Cache 分成固定大小 block。
- 请求按 block 映射物理显存。
- 支持连续批处理，把新请求动态塞进正在运行的 batch。

## Q27. vLLM 在推理阶段做了哪些优化

常见优化点：

| 优化 | 作用 |
| --- | --- |
| PagedAttention | 减少 KV Cache 显存碎片，提高显存利用率 |
| Continuous Batching | 动态合批，提高吞吐 |
| Prefix Cache | 相同前缀复用 KV，适合系统 prompt 或长文档问答 |
| Tensor Parallel | 多卡切分模型，支撑大模型推理 |
| Speculative Decoding | 小模型先草稿，大模型验证，加速生成 |

面试里重点讲：**vLLM 不是把单个 token 算得更快，而是把服务端批处理和 KV 管理做得更高效**。

## Q28. Flash Attention 的原理

Flash Attention 优化的是 attention 的显存读写。普通 attention 会显式生成完整的 `QK^T` 注意力矩阵，序列长度为 `n` 时显存是 `O(n²)`。

Flash Attention 的核心：

- 分块计算 attention。
- 在 SRAM 中完成局部 softmax 和累积。
- 避免把完整 attention 矩阵写回 HBM。
- 使用 online softmax 保持数值稳定。

效果：

- 显著减少显存占用。
- 长序列训练和推理更快。
- 结果和标准 attention 数学等价或近似等价，取决于实现精度。

## Q32. 模型量化是怎么量化的

量化是把高精度权重或激活从 FP16 / BF16 压到 INT8、INT4 等低比特表示。

基础公式：

```text
x_int = round(x_float / scale) + zero_point
x_float ≈ (x_int - zero_point) × scale
```

常见类型：

| 类型 | 说明 |
| --- | --- |
| PTQ | 训练后量化，不重新训练或只用少量校准数据 |
| QAT | 量化感知训练，训练中模拟量化误差 |
| Weight-only | 只量化权重，推理更常见 |
| KV Cache Quantization | 量化 KV Cache，降低长上下文显存 |

工程取舍：

- INT8 通常稳定，效果损失小。
- INT4 显存收益更大，但对模型和量化算法更敏感。
- AWQ、GPTQ、bitsandbytes NF4 都是常见路线。

## 推理优化深挖追问排查

### vLLM 为什么能提升吞吐

面试里不要只说 PagedAttention，要把推理分成两个阶段讲：

| 阶段 | 特点 | 瓶颈 |
| --- | --- | --- |
| Prefill | 一次性处理 prompt，计算所有 prompt token 的 KV | 计算密集 |
| Decode | 每次生成 1 个 token，并复用历史 KV | 显存带宽和调度密集 |

在线服务真正难的是 decode 阶段：每个请求长度不同，有的已经结束，有的还在生成。如果用固定 batch，很容易出现大量 padding 和等待。

vLLM 的核心收益来自：

- **连续批处理**：请求完成后，新的请求可以立刻进入 batch，不必等整个 batch 都结束。
- **PagedAttention**：KV cache 用 block 管理，不要求连续内存，减少碎片。
- **更高显存利用率**：同样显存能容纳更多并发请求。

面试回答：

> vLLM 不一定让单个请求首 token 更快，它主要提升服务端吞吐和并发能力。尤其是多用户同时生成时，连续批处理和 KV 分页管理能减少等待和显存浪费。

### KV Cache 到底缓存了什么

自回归生成时，第 `t` 步要关注前面所有 token。如果每一步都重新算历史 token 的 K/V，会非常浪费。

KV Cache 缓存的是每层 attention 里历史 token 的 `K` 和 `V`：

```text
第 t 步：
只计算新 token 的 Q/K/V
历史 token 的 K/V 直接从 cache 读取
```

显存占用大致和这些因素成正比：

```text
layers × sequence_length × hidden_size × batch_size × dtype_size × 2(K,V)
```

所以长上下文和高并发时，KV Cache 往往比权重更成为瓶颈。

### PagedAttention 为什么像操作系统分页

传统 KV Cache 像给每个请求分配一大段连续显存，问题是请求长度不确定，容易浪费和碎片化。

PagedAttention 把 KV Cache 切成固定大小 block：

- 逻辑上：每个请求有自己的 token 序列。
- 物理上：这些 token 的 KV 分散存在多个 block 中。
- 映射表：记录请求的逻辑 token 对应哪些物理 block。

这样做的好处：

- 不用提前给最大长度分配完整显存。
- 请求结束后 block 可以回收。
- 多个请求之间可以更灵活地调度。

### Flash Attention 为什么不是简单少算

Flash Attention 并没有改变 attention 的数学结果，它主要减少 HBM 显存读写。

普通 attention 的问题：

```text
QK^T 会生成 n × n 的注意力矩阵
这个矩阵很大，需要频繁读写 HBM
```

Flash Attention 的思路：

- 把 Q/K/V 分块搬进更快的 SRAM。
- 在块内计算局部 attention。
- 用 online softmax 维护全局 softmax 的数值稳定性。
- 不把完整 attention matrix 写回 HBM。

追问回答：

> Flash Attention 快，不是因为少算了 attention，而是因为减少了高成本显存访问。GPU 上很多时候瓶颈不是算力，而是 HBM 带宽。

### Online Softmax 为什么能保持正确

分块计算时，不能直接对每个块单独 softmax 后拼起来，因为 softmax 分母应该是全局所有 token 的指数和。

Online softmax 会维护两个量：

- 当前看到的最大值 `m`。
- 当前归一化分母 `l`。

每来一个新 block，就更新全局最大值和分母，从而得到和完整 softmax 等价的结果。

面试里不用推完整公式，说清楚：

> 它不是局部 softmax，而是边分块边维护全局 softmax 的最大值和归一化项，所以数值上仍然等价。

### 量化误差从哪里来

量化不是单纯把 FP16 改成 INT4，它会引入近似误差：

| 来源 | 说明 |
| --- | --- |
| scale 粒度 | per-tensor 粗，per-channel / per-group 更准 |
| outlier | 少数极大权重会拉大 scale，让普通值精度变差 |
| 激活分布 | activation 量化比 weight-only 更难 |
| 校准数据 | PTQ 依赖校准集，分布不匹配会掉点 |

常见回答：

> INT4 省显存明显，但不是所有层都同样适合量化。工程上会用 group-wise quantization、保护 outlier、或者只量化权重，来平衡效果和性能。

### 推理优化追问清单

| 追问 | 回答要点 |
| --- | --- |
| vLLM 优化首 token 还是吞吐？ | 主要优化吞吐和并发，prefill 首 token 还受模型计算影响 |
| PagedAttention 解决什么？ | KV Cache 显存碎片和预分配浪费 |
| Continuous batching 为什么有效？ | 动态把新请求塞进 decode batch，减少等待 |
| Flash Attention 改了数学公式吗？ | 不改公式，主要减少 HBM 读写 |
| 量化为什么会掉效果？ | 低比特近似、outlier、scale 粒度和校准数据都会带来误差 |
| INT4 一定比 INT8 快吗？ | 不一定，还要看 kernel、硬件支持、反量化开销和 batch size |
