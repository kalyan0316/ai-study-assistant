import { useCallback, useEffect, useRef, useState } from 'react';
import { postGenerate, RequestError } from '../lib/api.js';
import { OutputError, parseStudySet } from '../lib/studySet.js';

const SLOW_AFTER_MS = 7_000;
const TIMEOUT_MS = 45_000;

/**
 * Owns the lifecycle of one AI request at a time.
 *
 * - Every call gets an id. Only the latest id may update state, so a slow old
 *   response can never overwrite a newer one.
 * - Starting a new request aborts the previous fetch (saves tokens, frees the server).
 * - Timeout, cancel, network errors, HTTP errors and bad model output all end in
 *   a single `error` object the UI can render, never an uncaught exception.
 * - On success it calls `onSuccess(result, meta)`; the caller decides what to do
 *   with the data. If the request failed, the caller's existing data is untouched.
 */
export function useStudySetRequest({ onSuccess }) {
  const [state, setState] = useState({ status: 'idle', error: null, slow: false, meta: null });

  const latestId = useRef(0);
  const controllerRef = useRef(null);
  const lastCall = useRef(null);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => {
    onSuccessRef.current = onSuccess;
  });

  useEffect(() => () => controllerRef.current?.abort('unmount'), []);

  const run = useCallback(async (payload, meta = {}) => {
    controllerRef.current?.abort('superseded');
    const controller = new AbortController();
    controllerRef.current = controller;
    const id = ++latestId.current;
    const isLatest = () => id === latestId.current;
    lastCall.current = { payload, meta };

    setState({ status: 'loading', error: null, slow: false, meta });
    const slowTimer = setTimeout(() => isLatest() && setState((s) => ({ ...s, slow: true })), SLOW_AFTER_MS);
    const timeoutTimer = setTimeout(() => controller.abort('timeout'), TIMEOUT_MS);

    try {
      const body = await postGenerate(payload, controller.signal);
      if (!isLatest()) return;

      let result;
      try {
        result = parseStudySet(body.content);
      } catch (err) {
        // If the provider says it stopped because of length, say so instead of "invalid JSON".
        if (err instanceof OutputError && body.finishReason === 'length') {
          throw new OutputError('truncated', 'The AI ran out of space before finishing. Try a smaller set.');
        }
        throw err;
      }

      setState({ status: 'idle', error: null, slow: false, meta });
      onSuccessRef.current?.({ ...result, mock: Boolean(body.mock) }, meta, payload);
    } catch (err) {
      if (!isLatest()) return; // a newer request owns the UI now
      const reason = controller.signal.aborted ? controller.signal.reason : null;
      if (reason === 'cancelled' || reason === 'unmount') {
        setState({ status: 'idle', error: null, slow: false, meta: null });
        return;
      }
      setState({ status: 'error', error: describeError(err, reason), slow: false, meta });
    } finally {
      clearTimeout(slowTimer);
      clearTimeout(timeoutTimer);
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => controllerRef.current?.abort('cancelled'), []);

  const retry = useCallback(() => {
    if (lastCall.current) run(lastCall.current.payload, lastCall.current.meta);
  }, [run]);

  const dismiss = useCallback(() => setState({ status: 'idle', error: null, slow: false, meta: null }), []);

  return { ...state, loading: state.status === 'loading', run, cancel, retry, dismiss };
}

/** Map any failure to something a person can act on. `detail` is for the "technical details" toggle. */
export function describeError(err, abortReason) {
  if (abortReason === 'timeout') {
    return {
      title: 'This is taking too long',
      message: `No response after ${TIMEOUT_MS / 1000} seconds. The AI service may be busy.`,
      retryable: true,
      detail: 'client-timeout',
    };
  }

  if (err instanceof OutputError) {
    if (err.kind === 'declined') {
      return {
        title: 'Couldn’t make a study set from that',
        message: err.message,
        hint: 'Try pasting more detailed notes, or name a specific topic.',
        retryable: false,
        detail: 'model-declined',
      };
    }
    return {
      title: 'The AI sent back something we couldn’t use',
      message: err.message,
      hint: 'AI output varies between attempts, so retrying usually works.',
      retryable: true,
      detail: `output:${err.kind}`,
    };
  }

  if (err instanceof RequestError) {
    const titles = {
      network: 'You seem to be offline',
      'rate-limited': 'Too many requests',
      timeout: 'The AI took too long',
      auth: 'Server configuration problem',
      'upstream-error': 'The AI service had a problem',
      'upstream-unreachable': 'Couldn’t reach the AI service',
      'upstream-bad-body': 'The AI service had a problem',
      'json-mode-unsupported': 'Server configuration problem',
      'notes-too-short': 'Add some notes first',
      'notes-too-long': 'Notes are too long',
    };
    return {
      title: titles[err.code] || 'Something went wrong',
      message: err.message,
      retryable: err.retryable,
      detail: `request:${err.code}`,
    };
  }

  console.error(err);
  return { title: 'Something went wrong', message: 'An unexpected error occurred.', retryable: true, detail: String(err?.message || err) };
}
