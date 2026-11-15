import { useState } from 'react';

export function LoadingState({ slow, onCancel, refining }) {
  return (
    <div className="panel loading" role="status" aria-live="polite">
      <div className="spinner" aria-hidden="true" />
      <div>
        <p className="panel-title">{refining ? 'Updating your study set…' : 'Writing your flashcards and quiz…'}</p>
        <p className="muted small">
          {slow ? 'This is taking longer than usual. The AI service might be busy.' : 'This usually takes a few seconds.'}
        </p>
      </div>
      <button className="btn ghost small" onClick={onCancel}>Cancel</button>
    </div>
  );
}

export function SkeletonCard() {
  return (
    <div className="panel skeleton" aria-hidden="true">
      <div className="sk sk-title" />
      <div className="sk sk-tabs" />
      <div className="sk sk-card" />
    </div>
  );
}

export function ErrorState({ error, onRetry, onDismiss, keptPrevious }) {
  const [showDetail, setShowDetail] = useState(false);
  return (
    <div className="panel error" role="alert">
      <p className="panel-title">{error.title}</p>
      <p>{error.message}</p>
      {error.hint && <p className="muted small">{error.hint}</p>}
      {keptPrevious && <p className="muted small">Your current study set hasn’t been changed.</p>}
      <div className="button-row">
        {error.retryable && <button className="btn primary" onClick={onRetry}>Try again</button>}
        <button className="btn ghost" onClick={onDismiss}>Dismiss</button>
        {error.detail && (
          <button className="btn ghost small" onClick={() => setShowDetail((s) => !s)} aria-expanded={showDetail}>
            {showDetail ? 'Hide' : 'Technical'} details
          </button>
        )}
      </div>
      {showDetail && <code className="detail">{error.detail}</code>}
    </div>
  );
}
