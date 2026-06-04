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
