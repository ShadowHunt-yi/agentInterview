import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"","description":"","frontmatter":{"layout":"home","hero":{"name":"AI Agent 面试手册","text":"从模型原理到 RAG 工程的高频追问","tagline":"一份可持续扩展的面试准备文档，覆盖 LoRA、Transformer、vLLM、BGE-M3、混合检索、LangGraph、评测与文档解析。","image":{"src":"/hero-panel.svg","alt":"AI interview knowledge map"},"actions":[{"theme":"brand","text":"开始刷题","link":"/interview/"},{"theme":"alt","text":"RAG 专题","link":"/interview/rag/"}]},"features":[{"title":"模型基础","details":"Transformer、Encoder/Decoder、Embedding、LayerNorm/RMSNorm、RoPE、BERT/GPT 设计取舍。"},{"title":"微调与对齐","details":"LoRA 参数、适配器尺寸、SFT、RLHF、训练后的指令微调流程。"},{"title":"检索增强","details":"BGE-M3、父子块、混合检索、Rerank、Milvus HNSW、召回速度优化。"},{"title":"推理优化","details":"vLLM、PagedAttention、Flash Attention、量化方法与线上推理优化。"},{"title":"Agent 工程","details":"LangChain / LangGraph 区别、模型选型、Harness 评测与文档解析质量保障。"},{"title":"项目复盘","details":"从 Agent Copilot 项目稿提炼 LangGraph 编排、HITL、RAG 链路和质量闭环。"}]},"headers":[],"relativePath":"index.md","filePath":"index.md","lastUpdated":null}');
const _sfc_main = { name: "index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><div class="landing-strip"><a href="interview/lora/">LoRA</a><a href="interview/transformer/">Transformer</a><a href="interview/inference/">vLLM</a><a href="interview/rag/">RAG</a><a href="interview/alignment/">RLHF</a><a href="interview/agent/">Agent</a><a href="interview/project/">项目复盘</a></div></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
