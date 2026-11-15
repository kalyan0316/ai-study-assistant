import { useMemo, useState } from 'react';
import { shuffle, useHotkeys } from '../lib/util.js';

/**
 * Flip through cards, mark each "Got it" or "Still learning",
 * then review only the ones you missed. Keyboard: Space flip, ←/→ move, 1/2 mark.
 */
export default function Flashcards({ cards, active }) {
  const byId = useMemo(() => Object.fromEntries(cards.map((c) => [c.id, c])), [cards]);
  const [round, setRound] = useState(() => ({ ids: cards.map((c) => c.id), number: 1 }));
  const [index, setIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [marks, setMarks] = useState({}); // id -> 'known' | 'learning'

  const total = round.ids.length;
  const finished = index >= total;
  const card = finished ? null : byId[round.ids[index]];
  const missed = round.ids.filter((id) => marks[id] === 'learning');
  const known = round.ids.filter((id) => marks[id] === 'known');

  const go = (delta) => {
    setIndex((i) => Math.min(Math.max(i + delta, 0), total - 1));
    setFlipped(false);
  };

  const mark = (value) => {
    if (!card) return;
    setMarks((m) => ({ ...m, [card.id]: value }));
    setFlipped(false);
    setIndex((i) => i + 1);
  };

  const startRound = (ids) => {
    setRound((r) => ({ ids, number: r.number + 1 }));
    setIndex(0);
    setMarks({});
    setFlipped(false);
  };

  useHotkeys(
    {
      ' ': () => card && setFlipped((f) => !f),
      Enter: () => card && setFlipped((f) => !f),
      ArrowRight: () => !finished && go(1),
      ArrowLeft: () => !finished && go(-1),
      1: () => mark('learning'),
      2: () => mark('known'),
    },
    active,
  );

  if (!cards.length) {
    return <p className="empty-note">No flashcards in this set. Try the quiz tab.</p>;
  }

  if (finished) {
    return (
      <div className="round-summary" role="status">
        <h3>{round.number > 1 ? `Review round ${round.number} done` : 'Deck complete'}</h3>
        <div className="score-row">
          <div className="score good"><strong>{known.length}</strong> got it</div>
          <div className="score bad"><strong>{missed.length}</strong> still learning</div>
        </div>
        <div className="button-row">
          {missed.length > 0 && (
            <button className="btn primary" onClick={() => startRound(shuffle(missed))}>
              Review {missed.length} missed {missed.length === 1 ? 'card' : 'cards'}
            </button>
          )}
          <button className={`btn ${missed.length ? '' : 'primary'}`} onClick={() => startRound(shuffle(cards.map((c) => c.id)))}>
            Shuffle &amp; restart all
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flashcards">
      <div className="progress-row">
        <span>
          {round.number > 1 && <span className="pill">Review</span>} Card {index + 1} of {total}
        </span>
        <button className="btn ghost small" onClick={() => startRound(shuffle(round.ids))}>Shuffle</button>
      </div>
      <Progress value={index} max={total} />

      <button
        type="button"
        className={`card ${flipped ? 'is-flipped' : ''}`}
        onClick={() => setFlipped((f) => !f)}
        aria-label={flipped ? `Answer: ${card.back}. Click to show question.` : `Question: ${card.front}. Click to reveal answer.`}
      >
        <span className="card-inner">
          <span className="card-face card-front">
            <span className="card-label">Question</span>
            <span className="card-text">{card.front}</span>
            <span className="card-hint">Tap or press Space to flip</span>
          </span>
          <span className="card-face card-back">
            <span className="card-label">Answer</span>
            <span className="card-text">{card.back}</span>
          </span>
        </span>
      </button>

      <div className="card-controls">
        <button className="btn ghost icon" onClick={() => go(-1)} disabled={index === 0} aria-label="Previous card">←</button>
        <button className="btn bad-outline" onClick={() => mark('learning')}>Still learning <kbd>1</kbd></button>
        <button className="btn good-outline" onClick={() => mark('known')}>Got it <kbd>2</kbd></button>
        <button className="btn ghost icon" onClick={() => go(1)} disabled={index === total - 1} aria-label="Next card">→</button>
      </div>
    </div>
  );
}

export function Progress({ value, max }) {
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="progress-fill" style={{ width: `${max ? (value / max) * 100 : 0}%` }} />
    </div>
  );
}
