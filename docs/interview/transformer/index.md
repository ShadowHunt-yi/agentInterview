# Transformer 基础

## Q4. 讲一下 Transformer 原理

Transformer 是一种基于 **自注意力机制** 的序列建模架构。它不依赖 RNN 的逐步递归，而是让序列中每个 token 同时关注其他 token，通过 attention 学到上下文关系。

核心模块：

1. **Embedding + Position Encoding**：把 token 变成向量，并注入位置信息。
2. **Multi-Head Attention**：多组注意力头从不同子空间学习关系。
3. **Feed Forward Network**：对每个 token 的表示做非线性变换。
4. **Residual + LayerNorm**：稳定深层训练，缓解梯度问题。

自注意力计算可以概括为：

```text
Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V
```

`Q` 决定我要找什么，`K` 决定我能提供什么匹配信号，`V` 是真正被聚合的信息。

## Q5. 编码器和解码器的作用区别

| 维度 | Encoder | Decoder |
| --- | --- | --- |
| 输入 | 完整输入序列 | 已生成 token 或目标序列前缀 |
| 注意力 | 双向注意力，可看全局 | 因果注意力，只能看当前位置之前 |
| 目标 | 理解和表征输入 | 自回归生成下一个 token |
| 典型模型 | BERT、RoBERTa | GPT、LLaMA、Qwen |

Encoder 擅长理解，Decoder 擅长生成。Encoder-Decoder 则适合翻译、摘要等输入输出都很明确的任务。

## Q6. 为什么 BERT 用编码器，GPT 用解码器

BERT 的目标是做语言理解，例如分类、匹配、抽取。它需要同时看左右上下文，所以采用 Encoder 的双向注意力，并用 MLM 任务训练。

GPT 的目标是生成文本。生成时只能基于已经生成的内容预测下一个 token，所以采用 Decoder 的因果注意力。

一句话：

> BERT 是“读完整段话再理解”，GPT 是“从左到右一个 token 一个 token 写出来”。

## Q7. Embedding 的底层原理

Embedding 本质是一个可训练查表矩阵。假设词表大小是 `V`，隐藏维度是 `d`，Embedding 矩阵就是 `V × d`。token id 进来后，相当于取出对应行向量。

它学习到的是 token 在语义空间中的分布式表示：

- 语义相近的词向量距离更近。
- 句子 embedding 通常通过池化、CLS token 或专门模型训练得到。
- RAG 里的 embedding 更关注“查询和文档是否语义相关”，通常会用对比学习训练。

面试追问可以补：

> Embedding 不只是词典映射，它是在训练目标约束下形成的连续向量空间。语言模型里的 token embedding 服务于 next token prediction，检索模型里的 embedding 服务于相似度匹配，所以同样叫 embedding，训练目标和使用方式并不完全一样。

## Q36. LayerNorm、BatchNorm 和 RMSNorm 有什么区别

一句话先答：

> BatchNorm 按 batch 维度统计，适合 CNN 这类 batch 稳定的场景；LayerNorm 按单个样本的 hidden 维度统计，更适合 Transformer；RMSNorm 是 LayerNorm 的简化版，不减均值，只按均方根缩放，计算更省、在大模型里更常见。

### BatchNorm 是什么

BatchNorm 对一个 batch 内同一通道的激活做归一化。它关心的是“这个通道在一批样本上的分布”。

简化理解：

```text
BN(x) = gamma * (x - mean_batch) / sqrt(var_batch + eps) + beta
```

特点：

- 统计量依赖 batch。
- 训练和推理行为不同：推理时用训练阶段累计的 running mean / variance。
- batch 越小，统计越不稳定。
- 在 CNN 中很有效，因为图像特征通道有比较稳定的 batch 统计。

为什么不适合语言模型：

- NLP 序列长度不固定，batch 内 token 分布差异大。
- 自回归生成时 batch size 可能很小，甚至为 1。
- 推理阶段逐 token 生成，依赖 batch 统计不自然。

### LayerNorm 是什么

LayerNorm 对单个 token 的 hidden 维度做归一化。它不看 batch 里的其他样本，只看当前样本自身。

```text
LN(x) = gamma * (x - mean_hidden) / sqrt(var_hidden + eps) + beta
```

在 Transformer 中，`x` 通常是某个 token 的 hidden state，维度是 `hidden_size`。LayerNorm 会在这个 hidden 向量内部计算均值和方差。

特点：

- 不依赖 batch size。
- 训练和推理行为一致。
- 适合变长序列和自回归生成。
- 能稳定深层网络训练，避免激活尺度在残差连接中不断漂移。

Transformer 常见结构里有两种放法：

| 结构 | 位置 | 特点 |
| --- | --- | --- |
| Post-LN | `x + Sublayer(LN 或 Sublayer 后再 LN)` | 早期 Transformer 常见，但深层训练更难 |
| Pre-LN | `x + Sublayer(LN(x))` | 现代大模型常见，梯度更稳定 |

面试可补一句：

> 大模型普遍用 Pre-LN 或类似结构，是因为残差主干更像一条稳定的信息高速路，梯度更容易往前传。

### RMSNorm 是什么

RMSNorm 可以看作 LayerNorm 的简化版。它不减均值，只用 root mean square 归一化激活尺度：

```text
RMS(x) = sqrt(mean(x^2) + eps)
RMSNorm(x) = gamma * x / RMS(x)
```

和 LayerNorm 的关键区别：

- LayerNorm 做 re-centering：减去均值。
- RMSNorm 只做 re-scaling：按均方根缩放。

为什么现在很多大模型用 RMSNorm：

- 少算一个均值中心化步骤，计算更简单。
- 对大模型来说，控制激活尺度通常比严格置零均值更关键。
- 推理更省一点，尤其在超深层、长序列、高并发下会积累收益。
- LLaMA、Qwen 等 decoder-only 大模型都常用 RMSNorm 或类似变体。

### 三者核心对比

| 维度 | BatchNorm | LayerNorm | RMSNorm |
| --- | --- | --- | --- |
| 统计维度 | batch / channel | 单样本 hidden 维度 | 单样本 hidden 维度 |
| 是否依赖 batch | 是 | 否 | 否 |
| 是否减均值 | 是 | 是 | 否 |
| 是否除以方差/尺度 | 是 | 是 | 是，除以 RMS |
| 训练推理是否一致 | 不完全一致 | 一致 | 一致 |
| 常见场景 | CNN | Transformer | 现代 LLM |
| 优点 | 利用 batch 统计，CNN 中效果好 | 稳定、通用 | 更省计算，适合大模型 |

### 延伸追问

**Q: 为什么 Transformer 不用 BatchNorm？**

因为 Transformer 的 token 序列长度、padding、mask 和 batch size 都不稳定。BatchNorm 依赖 batch 统计，训练和推理还不一致；自回归生成时逐 token 推理，更不适合依赖 batch 维度。

**Q: LayerNorm 为什么能稳定训练？**

残差连接会不断叠加子层输出，如果激活尺度失控，深层网络很容易梯度不稳定。LayerNorm 把每层输入或输出拉回相对稳定的尺度，让 attention 和 MLP 的输入分布更可控。

**Q: RMSNorm 去掉均值会不会损失能力？**

理论上它少了 re-centering，但实践中大模型更关心激活尺度稳定。残差流和后续线性层仍然有足够表达能力，所以 RMSNorm 往往能在效果接近的情况下减少计算。

**Q: gamma 和 beta 是干什么的？**

归一化会把分布标准化，但模型不一定希望所有层都保持标准分布。`gamma` 和 `beta` 是可学习的缩放和平移，让模型自己决定归一化后该恢复到什么尺度。RMSNorm 通常只有 `gamma`，没有 `beta`。

## Q37. 位置编码有什么用，为什么用旋转位置编码

一句话先答：

> Transformer 的 attention 本身不天然知道 token 顺序，所以需要位置编码告诉模型“词在第几个位置”。旋转位置编码 RoPE 把位置信息注入到 Q/K 向量的旋转角度里，使注意力分数天然包含相对位置信息，因此很适合 decoder-only 大模型和长上下文扩展。

### 为什么需要位置编码

Self-Attention 对输入 token 的处理本质上是集合式的。没有位置编码时，模型只知道有哪些 token，不知道它们的顺序。

例如：

```text
我 喜欢 你
你 喜欢 我
```

这两句话 token 集合相同，但语义不同。如果没有位置信息，attention 很难区分顺序关系。

位置编码解决两个问题：

- **绝对位置**：这个 token 在第几个位置。
- **相对位置**：两个 token 相隔多远、谁在谁前面。

### 常见位置编码方式

| 方法 | 思路 | 优缺点 |
| --- | --- | --- |
| Sinusoidal PE | 用正弦余弦函数生成固定位置向量 | 无需训练，可外推，但表达相对朴素 |
| Learned Absolute PE | 每个位置一个可学习向量 | 简单有效，但外推到更长长度较弱 |
| Relative Position Bias | attention 分数里加相对距离偏置 | 相对位置强，常见于 T5 等 |
| ALiBi | 根据距离给 attention 加线性偏置 | 长度外推友好，简单高效 |
| RoPE | 旋转 Q/K 向量注入位置 | 同时保留绝对位置形式和相对位置效果，大模型常用 |

### RoPE 的直觉

RoPE 的做法是：把 hidden 向量按两两维度分组，每一组看成二维平面上的点，然后根据 token 位置把它旋转一个角度。

位置越靠后，旋转角度越大：

```text
q_pos = rotate(q, position)
k_pos = rotate(k, position)
attention_score = q_pos · k_pos
```

关键点在于：两个旋转后的向量做点积时，结果会和它们的**相对位置差**有关。

也就是说，RoPE 不只是告诉模型“我在第 10 个位置”，还让模型在 attention 分数里自然感知“我和另一个 token 隔了多少距离”。

### 为什么大模型喜欢 RoPE

1. **相对位置建模更自然**

   语言任务里，距离关系通常比绝对位置更重要。比如当前 token 更关注前面几个 token，或者关注同一句话里的实体。

2. **适合自回归解码**

   Decoder-only 模型每一步生成新 token，只需要给新的 Q/K 应用对应位置旋转，和 KV cache 结合方便。

3. **不会简单占用 embedding 加法通道**

   传统绝对位置编码通常直接加到 token embedding 上。RoPE 是作用在 attention 的 Q/K 上，把位置信息放进注意力匹配过程。

4. **长上下文扩展更好做**

   RoPE 本身仍然有训练长度限制，但可以通过 NTK scaling、YaRN、位置插值等方法扩展上下文，比 learned absolute position 更容易处理长上下文。

5. **工程实现简洁**

   只需要对 Q/K 做成对维度旋转，不改 V，不改 attention 主流程。

### RoPE 和绝对位置编码的区别

| 维度 | 绝对位置编码 | RoPE |
| --- | --- | --- |
| 注入位置 | embedding 层相加 | attention 的 Q/K |
| 强调信息 | token 的绝对位置 | attention 中的相对距离 |
| 长度外推 | learned PE 较弱 | 配合 scaling 更常见 |
| KV cache | 可用，但不突出 | 和 decoder-only 推理更契合 |
| 大模型使用 | 早期常见 | 现代 LLM 常见 |

### 延伸追问

**Q: 为什么 RoPE 只作用在 Q/K，不作用在 V？**

Attention 分数由 `QK^T` 决定，位置关系主要影响“该关注谁”。`V` 是被聚合的内容本身，不负责计算匹配关系，所以一般只旋转 Q/K。

**Q: RoPE 是否真的能无限外推？**

不能。RoPE 比 learned absolute PE 更适合扩展，但模型训练时见过的长度有限，超过训练长度后仍可能退化。实际长上下文模型通常会配合 RoPE scaling、继续训练或长上下文微调。

**Q: RoPE 为什么能表示相对位置？**

因为二维旋转有一个性质：两个分别旋转了位置 `m` 和 `n` 的向量做点积时，角度差里会出现 `m - n`。attention score 因此能感知 token 之间的相对距离。

**Q: 位置编码和 causal mask 是一回事吗？**

不是。位置编码告诉模型顺序和距离；causal mask 限制 decoder 不能看未来 token。一个提供位置信息，一个控制可见范围。

**Q: 面试里怎么简短回答？**

可以这样说：

> Attention 本身是 permutation-invariant 的，不加位置编码就不知道 token 顺序。RoPE 把位置变成 Q/K 向量的旋转角度，两个位置的 Q/K 点积会自然带上相对距离信息，所以它比单纯绝对位置编码更适合自回归大模型，也更方便做长上下文扩展。
