import { useMemo, useState } from 'react';
import { shuffle, useHotkeys } from '../lib/util.js';
import { Progress } from './Flashcards.jsx';

const LETTERS = 'ABCDEF';

function makeRound(ids, number, shuffleOptions, byId) {
  // `order[id]` is the display order of that question's options (indices into q.options).
  // Answers are stored as the ORIGINAL option index, so shuffling never breaks scoring.
  const order = Object.fromEntries(
    ids.map((id) => {
      const idx = byId[id].options.map((_, i) => i);
      return [id, shuffleOptions ? shuffle(idx) : idx];
    }),
  );
  return { ids, number, order };
}

/**
 * One question at a time, instant feedback, score at the end,
 * then retest only the questions you got wrong (with options re-shuffled).
 * Keyboard: 1–6 / A–F choose, Enter or → next.
 */
export default function Quiz({ questions, active }) {
  const byId = useMemo(() => Object.fromEntries(questions.map((q) => [q.id, q])), [questions]);
  const [round, setRound] = useState(() => makeRound(questions.map((q) => q.id), 1, false, byId));
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState({}); // id -> original option index chosen

  const total = round.ids.length;
  const finished = index >= total;
  const q = finished ? null : byId[round.ids[index]];
  const chosen = q ? answers[q.id] : undefined;
  const answered = chosen !== undefined;
  const wrongIds = round.ids.filter((id) => answers[id] !== byId[id].answerIndex);

  const choose = (optionIndex) => {
    if (!q || answered || optionIndex === undefined) return;
    setAnswers((a) => ({ ...a, [q.id]: optionIndex }));
  };
  const next = () => answered && setIndex((i) => i + 1);

  const startRound = (ids) => {
    setRound((r) => makeRound(ids, r.number + 1, true, byId));
    setIndex(0);
    setAnswers({});
  };

  const keyMap = { Enter: next, ArrowRight: next };
  if (q) {
    round.order[q.id].forEach((orig, pos) => {
      keyMap[String(pos + 1)] = () => choose(orig);
      keyMap[LETTERS[pos].toLowerCase()] = () => choose(orig);
    });
  }
  useHotkeys(keyMap, active);

  if (!questions.length) {
    return <p className="empty-note">No quiz questions in this set. Try the flashcards tab.</p>;
  }

  if (finished) {
    const score = total - wrongIds.length;
    const pct = Math.round((score / total) * 100);
    return (
      <div className="round-summary" role="status">
        <h3>{round.number > 1 ? `Retest ${round.number - 1} complete` : 'Quiz complete'}</h3>
        <p className="big-score">
          {score}/{total} <span>({pct}%)</span>
        </p>
        {wrongIds.length > 0 ? (
          <ul className="review-list">
            {wrongIds.map((id) => {
              const wq = byId[id];
              return (
                <li key={id}>
                  <p className="review-q">{wq.question}</p>
                  <p className="review-a bad">Your answer: {wq.options[answers[id]]}</p>
                  <p className="review-a good">Correct: {wq.options[wq.answerIndex]}</p>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="muted">Perfect score. Nothing to retest.</p>
        )}
        <div className="button-row">
          {wrongIds.length > 0 && (
            <button className="btn primary" onClick={() => startRound(shuffle(wrongIds))}>
              Retest {wrongIds.length} wrong {wrongIds.length === 1 ? 'answer' : 'answers'}
            </button>
          )}
          <button className={`btn ${wrongIds.length ? '' : 'primary'}`} onClick={() => startRound(shuffle(questions.map((x) => x.id)))}>
            Restart full quiz
          </button>
        </div>
      </div>
    );
  }

  const isCorrect = answered && chosen === q.answerIndex;

  return (
    <div className="quiz">
      <div className="progress-row">
        <span>
          {round.number > 1 && <span className="pill">Retest</span>} Question {index + 1} of {total}
        </span>
      </div>
      <Progress value={index} max={total} />

      <fieldset className="question">
        <legend>{q.question}</legend>
        <div className="options">
          {round.order[q.id].map((orig, pos) => {
            let cls = 'option';
            if (answered) {
              if (orig === q.answerIndex) cls += ' correct';
              else if (orig === chosen) cls += ' wrong';
              else cls += ' dim';
            }
            return (
              <button key={orig} className={cls} onClick={() => choose(orig)} disabled={answered} aria-pressed={orig === chosen}>
                <span className="option-letter">{LETTERS[pos]}</span>
                <span>{q.options[orig]}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {answered && (
        <div className={`feedback ${isCorrect ? 'good' : 'bad'}`} role="status">
          <strong>{isCorrect ? 'Correct!' : `Not quite. The answer is “${q.options[q.answerIndex]}”.`}</strong>
          {q.explanation && <p>{q.explanation}</p>}
          <button className="btn primary" onClick={next} autoFocus>
            {index === total - 1 ? 'See results' : 'Next question'} →
          </button>
        </div>
      )}
    </div>
  );
}
