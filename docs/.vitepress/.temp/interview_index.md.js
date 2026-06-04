import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"面试题总览","description":"","frontmatter":{},"headers":[],"relativePath":"interview/index.md","filePath":"interview/index.md","lastUpdated":1780543958000}');
const _sfc_main = { name: "interview/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="面试题总览" tabindex="-1">面试题总览 <a class="header-anchor" href="#面试题总览" aria-label="Permalink to &quot;面试题总览&quot;">​</a></h1><p>这套文档按面试追问链路拆成 6 个专题。建议先读 RAG 和 LoRA，因为它们最容易被连续追问；再补 Transformer、推理优化、训练对齐和 Agent 工程。</p><h2 id="快速路径" tabindex="-1">快速路径 <a class="header-anchor" href="#快速路径" aria-label="Permalink to &quot;快速路径&quot;">​</a></h2><table tabindex="0"><thead><tr><th>专题</th><th>覆盖问题</th><th>适合准备</th></tr></thead><tbody><tr><td><a href="/agentInterview/interview/lora/">LoRA 微调</a></td><td>1、2、3、23、24、25、26、29</td><td>参数、挂载层、适配器尺寸、训练配置</td></tr><tr><td><a href="/agentInterview/interview/transformer/">Transformer 基础</a></td><td>4、5、6、7、36、37</td><td>编码器、解码器、Embedding、Norm、位置编码、BERT/GPT</td></tr><tr><td><a href="/agentInterview/interview/inference/">推理优化</a></td><td>8、27、28、32</td><td>vLLM、Flash Attention、量化</td></tr><tr><td><a href="/agentInterview/interview/rag/">RAG 检索增强</a></td><td>11-20、30、31</td><td>分块、BGE-M3、混合检索、Milvus</td></tr><tr><td><a href="/agentInterview/interview/alignment/">训练与对齐</a></td><td>10、21、22</td><td>SFT、RLHF、训练后流程</td></tr><tr><td><a href="/agentInterview/interview/agent/">Agent 工程</a></td><td>9、33、34、35</td><td>LangChain/LangGraph、模型选型、评测、文档解析</td></tr><tr><td><a href="/agentInterview/interview/project/">项目实战复盘</a></td><td><code>nwe.md</code> 项目稿</td><td>LangGraph、RAG 链路、HITL、质量闭环</td></tr></tbody></table><h2 id="面试表达模板" tabindex="-1">面试表达模板 <a class="header-anchor" href="#面试表达模板" aria-label="Permalink to &quot;面试表达模板&quot;">​</a></h2><p>回答高频技术题时，尽量用这个顺序：</p><ol><li><strong>一句话定义</strong>：先说明它解决什么问题。</li><li><strong>关键机制</strong>：讲 2-3 个核心点，不要一上来堆公式。</li><li><strong>工程取舍</strong>：说明为什么这么配、速度和效果如何权衡。</li><li><strong>项目落点</strong>：把概念落到你项目里的参数、索引、链路或评测。</li></ol><p>示例：</p><blockquote><p>LoRA 的核心是冻结原模型权重，只训练低秩增量矩阵。这样把一个大矩阵的更新拆成两个小矩阵，训练参数量和显存都大幅下降；我一般会把它挂到注意力层的 q/k/v/o projection，必要时再挂 MLP 的 gate/up/down projection，通过 rank、alpha、dropout 控制拟合能力和稳定性。</p></blockquote><h2 id="后续新增内容方式" tabindex="-1">后续新增内容方式 <a class="header-anchor" href="#后续新增内容方式" aria-label="Permalink to &quot;后续新增内容方式&quot;">​</a></h2><p>新增题目时优先放到对应专题页。如果一个专题超过 20 道题，再拆成子页，例如 <code>rag/chunking.md</code>、<code>rag/retrieval.md</code>。导航在 <code>docs/.vitepress/config.ts</code> 里维护。</p></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("interview/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
