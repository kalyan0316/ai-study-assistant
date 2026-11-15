/**
 * Calls any OpenAI-compatible /chat/completions endpoint (Groq, Gemini, OpenRouter, OpenAI, Ollama...).
 * Returns the raw text the model produced. Parsing and validation happen in the browser
 * (src/lib/studySet.js) so the UI can explain exactly what went wrong.
 */

export class UpstreamError extends Error {
  constructor(code, message, status, retryable) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryable = retryable;
  }
}

export function llmConfig() {
  return {
    baseUrl: (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
    model: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
    apiKey: process.env.LLM_API_KEY || '',
    jsonMode: process.env.LLM_JSON_MODE !== 'false',
  };
}

export async function callLLM(messages, opts = {}) {
  const { jsonMode } = llmConfig();
  try {
    return await requestCompletion(messages, { ...opts, jsonMode });
  } catch (err) {
    // Some models/providers reject JSON mode. Our parser copes with plain text, so retry once without it.
    if (jsonMode && err.code === 'json-mode-unsupported') {
      console.warn('[llm] provider rejected JSON mode, retrying without it');
      return requestCompletion(messages, { ...opts, jsonMode: false });
    }
    throw err;
  }
}

async function requestCompletion(messages, { signal, timeoutMs = 40_000, jsonMode }) {
  const { baseUrl, model, apiKey } = llmConfig();

  // One controller that fires on either our timeout or the browser disconnecting.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), timeoutMs);
  const onClientAbort = () => controller.abort('client-closed');
  signal?.addEventListener('abort', onClientAbort);

  const body = { model, messages, temperature: 0.4 };
  if (jsonMode) body.response_format = { type: 'json_object' };

  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (controller.signal.reason === 'timeout') {
      throw new UpstreamError('timeout', 'The AI model took too long to respond.', 504, true);
    }
    if (controller.signal.reason === 'client-closed') {
      throw new UpstreamError('client-closed', 'Request cancelled.', 499, false);
    }
    throw new UpstreamError('upstream-unreachable', 'Could not reach the AI provider.', 502, true);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onClientAbort);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`[llm] ${res.status} from provider: ${detail.slice(0, 300)}`);
    if (res.status === 429) {
      throw new UpstreamError('rate-limited', 'The AI provider is rate-limiting requests. Wait a few seconds and retry.', 429, true);
    }
    if (res.status === 401 || res.status === 403) {
      throw new UpstreamError('auth', 'The server’s AI API key was rejected. Check LLM_API_KEY in .env.', 502, false);
    }
    if (res.status === 400 && /json_validate_failed|failed to generate json/i.test(detail)) {
      // Provider-side JSON mode caught the model writing invalid JSON. A retry usually works.
      throw new UpstreamError('upstream-bad-output', 'The AI produced invalid JSON. Please try again.', 502, true);
    }
    if (res.status === 400 && /response_format|json mode|json_object/i.test(detail)) {
      throw new UpstreamError('json-mode-unsupported', 'This model does not support JSON mode. Set LLM_JSON_MODE=false in .env.', 502, false);
    }
    if (res.status === 404 || /model_not_found|decommissioned|does not exist|not found/i.test(detail)) {
      throw new UpstreamError(
        'model-unavailable',
        `The AI model "${model}" isn't available from this provider. Change LLM_MODEL in .env (see .env.example).`,
        502,
        false,
      );
    }
    throw new UpstreamError('upstream-error', `The AI provider returned an error (${res.status}).`, 502, res.status >= 500);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new UpstreamError('upstream-bad-body', 'The AI provider sent an unreadable response.', 502, true);
  }

  const choice = data?.choices?.[0];
  return {
    content: typeof choice?.message?.content === 'string' ? choice.message.content : '',
    finishReason: choice?.finish_reason ?? null,
    model: data?.model ?? model,
  };
}
