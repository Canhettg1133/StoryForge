import { createAIService, getAIStudioConnectorUrl, getAIStudioRelayRoomCode, getAIStudioRelayUrl, getGeminiDirectBaseUrl, getOllamaRuntimeConfig, getOllamaUrl } from '../../services/ai/client.js';
import { getActiveOpenAIProxyProfile } from '../../services/ai/openAIProxyConfig.js';
import { TASK_TYPES } from '../../services/ai/router.js';
import { estimateTokens } from '../../services/labLite/tokenEstimator.js';
import { buildReviewContract } from './contract.js';
import { REVIEW_LIMITS, REVIEW_MODES, REVIEW_VERSION } from './constants.js';
import { buildReviewMessages } from './prompts.js';
import { parseReviewResult } from './results.js';
import { saveReviewReport } from './repository.js';
import { hashReviewValue, stableReviewJson } from './snapshot.js';

const TASKS = { signals: TASK_TYPES.PROSE_AI_SIGNALS, adherence: TASK_TYPES.PROSE_STYLE_ADHERENCE, literary: TASK_TYPES.PROSE_LITERARY_SCORE };

function connectionSignature(route) {
  if (route.provider === 'ollama') return getOllamaUrl();
  if (route.provider === 'gemini_direct') return getGeminiDirectBaseUrl();
  if (route.provider === 'ai_studio_relay') return stableReviewJson([getAIStudioRelayUrl(), getAIStudioRelayRoomCode(), getAIStudioConnectorUrl()]);
  if (route.provider === 'openai_proxy') {
    const { id, baseUrl, chatCompletionsPath, authType, requiresApiKey, supportsGeminiSafetySettings, transport } = getActiveOpenAIProxyProfile(route.proxyProfileId);
    return stableReviewJson({ id, baseUrl, chatCompletionsPath, authType, requiresApiKey, supportsGeminiSafetySettings, transport });
  }
  throw new Error('Provider này chưa hỗ trợ phân tích văn bản. Hãy chọn provider văn bản trong Cài đặt.');
}

function errorMessage(error) {
  return error?.message || error?.userMessage || 'Không nhận được báo cáo hợp lệ. Hãy kiểm tra kết nối rồi thử lại.';
}

export function startManuscriptReview({ snapshot, modes, route, authorRequest = '', onProgress = () => {} }) {
  const frozenRoute = Object.freeze({ provider: route.provider, model: route.model, proxyProfileId: route.proxyProfileId });
  const service = createAIService({ router: { route: () => frozenRoute, getFallbacks: () => [] } });
  let cancelled = false;
  let cancelPass = null;
  const cancel = () => { cancelled = true; cancelPass?.(); service.abort(); };

  const done = (async () => {
    if (!frozenRoute.model) throw new Error('Chưa chọn model phân tích.');
    if (!Array.isArray(modes) || !modes.length || modes.some((mode) => !REVIEW_MODES.includes(mode))) throw new Error('Hãy chọn phần cần phân tích.');
    if (!snapshot.text?.trim()) throw new Error('Chưa có nội dung để phân tích.');
    if (snapshot.text.length > REVIEW_LIMITS.sourceCharacters) throw new Error('Bản đầu hỗ trợ tối đa 60.000 ký tự. Hãy chọn đoạn ngắn hơn.');
    if (!snapshot.project_id || !snapshot.scene_id) throw new Error('Chưa xác định được dự án hoặc cảnh.');
    const connection = connectionSignature(frozenRoute);
    const contract = buildReviewContract({ ...snapshot.context, authorRequest });
    if (contract.requirements.length > REVIEW_LIMITS.requirements) throw new Error('Quá nhiều yêu cầu riêng lẻ; hãy rút gọn hướng dẫn đánh giá.');
    const passes = REVIEW_MODES.filter((mode) => modes.includes(mode)).map((mode) => {
      const messages = buildReviewMessages({ snapshot, contract, mode });
      const inputTokens = estimateTokens(messages.map((message) => message.content).join('\n')) + 64;
      if (inputTokens > REVIEW_LIMITS.inputTokens) throw new Error('Prompt vượt 16.000 token ước lượng. Hãy thu hẹp đoạn hoặc yêu cầu; nội dung không bị cắt tự động.');
      if (frozenRoute.provider === 'ollama' && inputTokens + 2048 > getOllamaRuntimeConfig(frozenRoute.model).settings.num_ctx) {
        throw new Error('Vượt ngân sách context hiện có của Ollama (đã dự phòng 2.048 token trả lời). Hãy chọn đoạn ngắn hơn hoặc đổi model.');
      }
      return { mode, messages, inputTokens };
    });
    const sourceHash = hashReviewValue(snapshot.paragraphs.map((item) => item.text));
    const [sourceSignature, sceneSignature, configSignature] = await Promise.all([
      sourceHash, snapshot.scope === 'scene' ? sourceHash : hashReviewValue(snapshot.sceneParagraphs), hashReviewValue(contract),
    ]);
    const runId = crypto.randomUUID();
    const reports = [];
    const errors = {};
    for (const { mode, messages, inputTokens } of passes) {
      if (cancelled) break;
      if (connectionSignature(frozenRoute) !== connection) {
        const message = 'Cấu hình kết nối đã thay đổi. Các phần chưa chạy đã dừng; hãy xác nhận model rồi chạy lại.';
        for (const pending of passes.slice(passes.findIndex((pass) => pass.mode === mode))) {
          errors[pending.mode] = message;
          onProgress({ mode: pending.mode, status: 'error', error: message });
        }
        break;
      }
      onProgress({ mode, status: 'running', inputTokens });
      try {
        const raw = await new Promise((resolve, reject) => {
          let settled = false;
          const finish = (error, value) => {
            if (settled) return;
            settled = true; clearTimeout(timer); cancelPass = null;
            if (error) reject(error); else resolve(value);
          };
          const stop = (message) => { finish(new Error(message)); service.abort(); };
          const timer = setTimeout(() => stop('Đã dừng sau 180 giây chờ phản hồi. Báo cáo cũ được giữ nguyên.'), REVIEW_LIMITS.timeoutMs);
          cancelPass = () => stop('Đã hủy phân tích.');
          service.send({ taskType: TASKS[mode], messages, stream: true, autoContinueOnIncomplete: false, maxContinuationAttempts: 0, allowTransportFallback: false, preserveStructuredOutput: true,
            onToken: (_chunk, fullText) => { if (fullText.length > REVIEW_LIMITS.outputCharacters) stop('Phản hồi AI vượt giới hạn 64.000 ký tự.'); },
            onComplete: (text) => finish(null, text), onError: (error) => finish(new Error(errorMessage(error))),
          });
        });
        if (cancelled) break;
        const result = parseReviewResult(raw, { mode, snapshot, contract });
        const report = await saveReviewReport({
          project_id: snapshot.project_id, chapter_id: snapshot.chapter_id, scene_id: snapshot.scene_id,
          scope: snapshot.scope, mode, analysis_run_id: runId,
          source_signature: sourceSignature, scene_signature: sceneSignature, config_signature: configSignature,
          rubric_version: REVIEW_VERSION, model: frozenRoute.model, provider: frozenRoute.provider, proxy_profile_id: frozenRoute.proxyProfileId,
          author_request: authorRequest, requirements: contract.requirements, created_at: new Date().toISOString(),
          estimated_input_tokens: inputTokens, result,
        }, () => cancelled);
        if (report) { reports.push(report); onProgress({ mode, status: 'complete', report }); }
      } catch (error) {
        if (cancelled) break;
        errors[mode] = errorMessage(error);
        onProgress({ mode, status: 'error', error: errors[mode] });
      }
    }
    return { reports, errors, cancelled };
  })();
  return { done, cancel };
}
