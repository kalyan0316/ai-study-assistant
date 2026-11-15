import { useCallback, useEffect, useRef, useState } from 'react';
import InputPanel, { SIZES } from './components/InputPanel.jsx';
import StudyView from './components/StudyView.jsx';
import History from './components/History.jsx';
import { ErrorState, LoadingState, SkeletonCard } from './components/RequestStatus.jsx';
import { useStudySetRequest } from './hooks/useStudySetRequest.js';
import { useSessions } from './hooks/useSessions.js';
import { getHealth } from './lib/api.js';
import { toModelShape } from './lib/studySet.js';
import { newId } from './lib/util.js';

export default function App() {
  const [notes, setNotes] = useState('');
  const [size, setSize] = useState('standard');
  const [simulate, setSimulate] = useState('none');
  const [health, setHealth] = useState(null);
  const [current, setCurrent] = useState(null); // the session on screen
  const { sessions, upsert, remove } = useSessions();
  const currentRef = useRef(current);
  useEffect(() => {
    currentRef.current = current;
  }, [current]);

  useEffect(() => {
    getHealth().then(setHealth);
  }, []);

  const handleSuccess = useCallback(
    ({ set, warnings, mock }, meta) => {
      const now = Date.now();
      if (meta.kind === 'refine') {
        // Only apply if the user is still looking at the set this edit was for.
        const cur = currentRef.current;
        if (!cur || cur.id !== meta.sessionId) return;
        const next = { ...cur, set, warnings, mock, updatedAt: now, version: cur.version + 1 };
        setCurrent(next);
        upsert(next);
        return;
      }
      const session = { id: newId(), notes: meta.notes, set, warnings, mock, createdAt: now, updatedAt: now, version: 1 };
      setCurrent(session);
      upsert(session);
    },
    [upsert],
  );

  const request = useStudySetRequest({ onSuccess: handleSuccess });

  const generate = () => {
    const trimmed = notes.trim();
    request.run({ notes: trimmed, ...pick(SIZES[size]), simulate }, { kind: 'generate', notes: trimmed });
  };

  const refine = (instruction) => {
    if (!current) return;
    request.run(
      { notes: current.notes, ...pick(SIZES[size]), simulate, refine: { instruction, current: toModelShape(current.set) } },
      { kind: 'refine', sessionId: current.id },
    );
  };

  const openSession = (s) => {
    request.cancel(); // an in-flight request must not replace what the user just chose
    request.dismiss();
    setCurrent(s);
    setNotes(s.notes);
  };

  const deleteSession = (id) => {
    remove(id);
    if (current?.id === id) setCurrent(null);
  };

  const refining = request.meta?.kind === 'refine';

  // On phones the results sit above the form, so bring them into view when something changes.
  const contentRef = useRef(null);
  const statusKey = `${request.status}:${current?.id}:${current?.version}`;
  useEffect(() => {
    if (statusKey.startsWith('idle:undefined')) return;
    if (window.matchMedia?.('(max-width: 820px)').matches) {
      contentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [statusKey]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">◆</span>
          <h1>Study Assistant</h1>
        </div>
        {health?.mock && (
          <span className="pill warn" title="Set LLM_API_KEY in .env to use a real model">Mock mode: no API key</span>
        )}
        {health && !health.mock && <span className="pill muted-pill">{health.model}</span>}
      </header>

      <main className="layout">
        <aside className="sidebar">
          <InputPanel
            notes={notes}
            setNotes={setNotes}
            size={size}
            setSize={setSize}
            onSubmit={generate}
            loading={request.loading && !refining}
          />
          <History sessions={sessions} currentId={current?.id} onOpen={openSession} onDelete={deleteSession} />
          <DebugPanel value={simulate} onChange={setSimulate} options={health?.simulations} />
        </aside>

        <div className="content" ref={contentRef}>
          {request.loading && <LoadingState slow={request.slow} onCancel={request.cancel} refining={refining} />}

          {request.status === 'error' && (
            <ErrorState
              error={request.error}
              onRetry={request.retry}
              onDismiss={request.dismiss}
              keptPrevious={Boolean(current)}
            />
          )}

          {current ? (
            <StudyView
              key={`${current.id}:${current.version}`}
              session={current}
              onRefine={refine}
              refining={request.loading && refining}
              busy={request.loading}
            />
          ) : request.loading ? (
            <SkeletonCard />
          ) : (
            request.status !== 'error' && <EmptyState />
          )}
        </div>
      </main>
    </div>
  );
}

const pick = ({ cardCount, quizCount }) => ({ cardCount, quizCount });

function EmptyState() {
  return (
    <div className="panel empty">
      <div className="empty-art" aria-hidden="true">
        <span className="mini-card one" />
        <span className="mini-card two" />
        <span className="mini-card three" />
      </div>
      <h2>Turn notes into practice</h2>
      <ol className="steps">
        <li>Paste notes or type a topic on the left.</li>
        <li>Flip through flashcards and mark what you know.</li>
        <li>Take the quiz, then retest only what you got wrong.</li>
      </ol>
    </div>
  );
}

/** Lets you force each failure mode from the server so the error handling can be demoed. */
function DebugPanel({ value, onChange, options }) {
  if (!options) return null;
  return (
    <details className="panel debug">
      <summary>Developer: simulate AI failures</summary>
      <p className="muted small">
        Makes the server return a fake response instead of calling the model. Try “slow”, then generate again
        before it finishes: the old response is discarded.
      </p>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Simulated response">
        {options.map((o) => (
          <option key={o} value={o}>{o === 'none' ? 'none (real response)' : o}</option>
        ))}
      </select>
    </details>
  );
}
