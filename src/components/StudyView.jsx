import { useState } from 'react';
import Flashcards from './Flashcards.jsx';
import Quiz from './Quiz.jsx';

const REFINE_IDEAS = ['Make the quiz harder', 'Add 3 more flashcards', 'Simpler wording for beginners'];

export default function StudyView({ session, onRefine, refining, busy }) {
  const { set, warnings, mock } = session;
  const [tab, setTab] = useState(set.cards.length ? 'cards' : 'quiz');
  const [instruction, setInstruction] = useState('');

  const submitRefine = (e) => {
    e.preventDefault();
    const text = instruction.trim();
    if (text && !busy) onRefine(text);
  };

  return (
    <section className="panel study" aria-labelledby="set-title">
      <header className="study-header">
        <div>
          <h2 id="set-title">{set.title}</h2>
          <p className="muted small">
            {set.cards.length} flashcards · {set.quiz.length} questions
            {mock && <span className="pill warn">sample data</span>}
          </p>
        </div>
      </header>

      {warnings?.length > 0 && (
        <details className="notice">
          <summary>Some AI output was fixed or skipped ({warnings.length})</summary>
          <ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </details>
      )}

      <div className="tabs" role="tablist" aria-label="Study mode">
        <button role="tab" aria-selected={tab === 'cards'} className="tab" onClick={() => setTab('cards')} disabled={!set.cards.length}>
          Flashcards
        </button>
        <button role="tab" aria-selected={tab === 'quiz'} className="tab" onClick={() => setTab('quiz')} disabled={!set.quiz.length}>
          Quiz
        </button>
      </div>

      {/* Both stay mounted so switching tabs keeps your place; only the visible one listens to keys. */}
      <div role="tabpanel" hidden={tab !== 'cards'}>
        <Flashcards cards={set.cards} active={tab === 'cards'} />
      </div>
      <div role="tabpanel" hidden={tab !== 'quiz'}>
        <Quiz questions={set.quiz} active={tab === 'quiz'} />
      </div>

      <form className="refine" onSubmit={submitRefine}>
        <label htmlFor="refine" className="small strong">Change this set</label>
        <div className="refine-row">
          <input
            id="refine"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. focus more on the Calvin cycle"
            maxLength={500}
          />
          <button className="btn" type="submit" disabled={!instruction.trim() || busy}>
            {refining ? 'Updating…' : 'Update'}
          </button>
        </div>
        <div className="examples">
          {REFINE_IDEAS.map((idea) => (
            <button key={idea} type="button" className="chip" onClick={() => setInstruction(idea)}>{idea}</button>
          ))}
        </div>
      </form>
    </section>
  );
}
