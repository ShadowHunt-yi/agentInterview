# LoRA 微调

## Q1. 讲一下 LoRA 原理

LoRA 的核心思想是：**冻结原模型权重，只训练一个低秩的增量更新**。原本全量微调要直接更新权重矩阵 `W`，LoRA 改成：

```text
W' = W + ΔW
ΔW = B × A
```

其中 `A` 和 `B` 是两个小矩阵，rank 为 `r`，通常远小于原矩阵维度。这样训练参数量从 `d_in × d_out` 降到 `r × (d_in + d_out)`。

面试里可以这样说：

> LoRA 认为大模型在特定任务上的权重更新往往是低秩的，所以不必训练完整权重矩阵。它用两个低秩矩阵近似权重增量，推理时把增量加回原权重，达到低成本适配任务的效果。

## Q2. LoRA 挂在哪层

最常见挂在 Transformer 的线性投影层：

| 位置 | 常见模块名 | 作用 |
| --- | --- | --- |
| Attention | `q_proj`、`k_proj`、`v_proj`、`o_proj` | 改变注意力查询、匹配、聚合和输出 |
| MLP | `gate_proj`、`up_proj`、`down_proj` | 增强任务表达和非线性变换能力 |
| Embedding / LM Head | 较少使用 | 词表或输出分布适配，风险和成本更高 |

工程上常用策略：

- 资源紧张或数据少：优先挂 `q_proj`、`v_proj`。
- 想要效果更强：挂 `q/k/v/o`。
- 任务风格变化大：再加 MLP 的 `gate/up/down`。

## Q3. LoRA 有哪些参数配置，会影响什么

| 参数 | 含义 | 影响 |
| --- | --- | --- |
| `r` / `rank` | 低秩矩阵维度 | 越大拟合能力越强，显存和过拟合风险也越高 |
| `lora_alpha` | LoRA 缩放系数 | 控制增量权重强度，常见有效缩放是 `alpha / r` |
| `lora_dropout` | LoRA 分支 dropout | 抑制过拟合，数据少时更有用 |
| `target_modules` | 挂载模块 | 决定改模型的哪些能力 |
| `bias` | 是否训练 bias | 一般设 `none`，稳定且省参数 |
| `task_type` | 任务类型 | Causal LM、Seq2Seq、分类等 |
| `modules_to_save` | 额外保存模块 | 常用于保存 `lm_head` 或分类头 |

## Q23. LoRA 适配器和原模型尺寸有什么关系

LoRA 适配器尺寸和原矩阵输入输出维度、rank 有关。假设原线性层权重是 `d_out × d_in`，LoRA 参数量约为：

```text
r × d_in + d_out × r = r × (d_in + d_out)
```

所以模型越大、挂载层越多、rank 越高，适配器越大。但相比全量权重，LoRA 通常只占原模型参数量的很小一部分。

## Q24. 哪个参数影响拟合能力

最直接的是 `rank`。rank 越大，低秩增量矩阵能表达的变化越复杂，拟合能力越强。其次是 `target_modules`，挂载更多模块也会提升可训练参数量和表达能力。

面试追问可以补：

> rank 不是越大越好。数据量小的时候 rank 太大容易记忆训练集，泛化变差；数据足够、任务复杂时可以提高 rank 或扩展 target modules。

## Q25. Rank 和两个小矩阵有什么关系

rank 就是两个小矩阵中间的瓶颈维度：

```text
A: r × d_in
B: d_out × r
ΔW = B × A
```

`r` 越小，`ΔW` 的秩上限越低，表达更受限制；`r` 越大，越接近全量更新，但训练成本也会上升。

## Q26. LoRA 微调用什么算力卡

面试不一定要说固定型号，重点说清楚依据：

- 7B 模型：单张 24GB 卡配合 QLoRA 通常可做 SFT。
- 14B 模型：更稳妥是 48GB 或多卡。
- 32B 以上：通常需要多卡、ZeRO、FSDP 或更激进量化。

可用话术：

> 我会先看模型规模、序列长度、batch size 和是否用 QLoRA。LoRA 本身省的是可训练参数和优化器状态，但前向激活和 KV 仍然占显存，所以长上下文训练时显存压力仍然明显。

## Q29. LoRA 参数怎么设置，为什么

一个保守起步配置：

```text
r = 8 或 16
lora_alpha = 16 或 32
lora_dropout = 0.05
target_modules = q_proj, k_proj, v_proj, o_proj
bias = none
```

调整思路：

- 欠拟合：提高 `r`，扩大 `target_modules` 到 MLP。
- 过拟合：降低 `r`，提高 dropout，减少 epoch。
- 风格迁移强：适当提高 alpha 或挂 MLP。
- 事实问答类：更关注数据质量和防遗忘，不盲目加 rank。
