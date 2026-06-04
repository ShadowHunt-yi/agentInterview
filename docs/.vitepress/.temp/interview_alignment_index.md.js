import { ssrRenderAttrs } from "vue/server-renderer";
import { useSSRContext } from "vue";
import { _ as _export_sfc } from "./plugin-vue_export-helper.1tPrXgE0.js";
const __pageData = JSON.parse('{"title":"训练与对齐","description":"","frontmatter":{},"headers":[],"relativePath":"interview/alignment/index.md","filePath":"interview/alignment/index.md","lastUpdated":null}');
const _sfc_main = { name: "interview/alignment/index.md" };
function _sfc_ssrRender(_ctx, _push, _parent, _attrs, $props, $setup, $data, $options) {
  _push(`<div${ssrRenderAttrs(_attrs)}><h1 id="训练与对齐" tabindex="-1">训练与对齐 <a class="header-anchor" href="#训练与对齐" aria-label="Permalink to &quot;训练与对齐&quot;">​</a></h1><h2 id="q10-模型训练完之后要干啥" tabindex="-1">Q10. 模型训练完之后要干啥 <a class="header-anchor" href="#q10-模型训练完之后要干啥" aria-label="Permalink to &quot;Q10. 模型训练完之后要干啥&quot;">​</a></h2><p>预训练完成后，模型只是学会了语言分布，不一定会按人的指令做事。通常后续流程是：</p><ol><li><strong>SFT 指令微调</strong>：用高质量指令数据教模型遵循任务格式。</li><li><strong>偏好对齐</strong>：用 RLHF、DPO 等方法让模型更符合人类偏好。</li><li><strong>安全对齐</strong>：拒答策略、敏感内容、工具调用约束。</li><li><strong>评测与回归</strong>：通用能力、领域能力、幻觉率、工具调用成功率。</li><li><strong>部署优化</strong>：量化、推理服务、监控、灰度发布。</li></ol><p>面试里可以说：</p><blockquote><p>预训练不是终点。面向业务使用时，还要做指令微调、偏好对齐、评测、压缩部署和线上监控。</p></blockquote><h2 id="q21-强化学习是什么机制" tabindex="-1">Q21. 强化学习是什么机制 <a class="header-anchor" href="#q21-强化学习是什么机制" aria-label="Permalink to &quot;Q21. 强化学习是什么机制&quot;">​</a></h2><p>强化学习是智能体和环境交互，通过奖励信号学习策略的机制。基本要素：</p><table tabindex="0"><thead><tr><th>元素</th><th>含义</th></tr></thead><tbody><tr><td>Agent</td><td>做决策的主体</td></tr><tr><td>State</td><td>当前状态</td></tr><tr><td>Action</td><td>可执行动作</td></tr><tr><td>Reward</td><td>动作后的奖励</td></tr><tr><td>Policy</td><td>从状态到动作的策略</td></tr></tbody></table><p>在 LLM 对齐中，RLHF 通常是：</p><ol><li>收集人类偏好数据。</li><li>训练奖励模型。</li><li>用 PPO 等算法优化语言模型，让输出获得更高奖励。</li></ol><h2 id="q22-强化学习和指令微调有什么不同" tabindex="-1">Q22. 强化学习和指令微调有什么不同 <a class="header-anchor" href="#q22-强化学习和指令微调有什么不同" aria-label="Permalink to &quot;Q22. 强化学习和指令微调有什么不同&quot;">​</a></h2><table tabindex="0"><thead><tr><th>对比</th><th>SFT 指令微调</th><th>强化学习 / RLHF</th></tr></thead><tbody><tr><td>数据</td><td>指令-答案样本</td><td>偏好、奖励或环境反馈</td></tr><tr><td>目标</td><td>模仿标准答案</td><td>最大化奖励</td></tr><tr><td>训练信号</td><td>交叉熵 loss</td><td>reward / advantage</td></tr><tr><td>优点</td><td>稳定、简单、可控</td><td>能优化难以写成标准答案的偏好</td></tr><tr><td>风险</td><td>受限于示例质量</td><td>训练不稳定，奖励模型可能被钻空子</td></tr></tbody></table><p>一句话：</p><blockquote><p>SFT 是“照着好答案学”，RLHF 是“根据偏好反馈调整输出策略”。</p></blockquote></div>`);
}
const _sfc_setup = _sfc_main.setup;
_sfc_main.setup = (props, ctx) => {
  const ssrContext = useSSRContext();
  (ssrContext.modules || (ssrContext.modules = /* @__PURE__ */ new Set())).add("interview/alignment/index.md");
  return _sfc_setup ? _sfc_setup(props, ctx) : void 0;
};
const index = /* @__PURE__ */ _export_sfc(_sfc_main, [["ssrRender", _sfc_ssrRender]]);
export {
  __pageData,
  index as default
};
