/** Thin wrapper around POST /api/generate that turns every failure into a RequestError. */

export class RequestError extends Error {
  constructor(code, message, retryable = true) {
    super(message);
    this.name = 'RequestError';
    this.code = code;
    this.retryable = retryable;
  }
}

export async function postGenerate(payload, signal) {
  let res;
  try {
    res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err; // let the caller decide what an abort means
    throw new RequestError('network', 'Couldn’t reach the server. Check your connection and try again.');
  }

  let body = null;
  try {
    body = await res.json();
  } catch {
    if (signal?.aborted) throw signal.reason;
  }

  if (!res.ok) {
    const e = body?.error;
    throw new RequestError(
      e?.code || `http-${res.status}`,
      e?.message || `The server returned an error (${res.status}).`,
      e?.retryable ?? res.status >= 500,
    );
  }
  if (!body || typeof body !== 'object') {
    throw new RequestError('bad-server-response', 'The server sent an unreadable response.');
  }
  return body; // { content, finishReason, mock }
}

export async function getHealth() {
  try {
    const res = await fetch('/api/health');
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}
