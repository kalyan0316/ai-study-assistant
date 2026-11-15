/**
 * Turns whatever the model sent back into a StudySet the UI can trust, or throws
 * an OutputError that says what went wrong in plain language.
 *
 * Strategy: be forgiving about *format* (code fences, prose around the JSON, field
 * name variants, answer given as text instead of index) but strict about *meaning*
 * (every card needs both sides, every question needs >= 2 distinct options and a
 * correct answer that is actually one of them). Bad items are dropped and reported
 * as warnings; the set is only rejected if nothing usable is left.
 *
 * StudySet = {
 *   title: string,
 *   cards: { id, front, back }[],
 *   quiz:  { id, question, options: string[], answerIndex, explanation }[],
 * }
 */

export const LIMITS = {
  title: 120,
  cardText: 600,
  question: 500,
  option: 200,
  explanation: 600,
  maxCards: 50,
  maxQuestions: 30,
  minOptions: 2,
  maxOptions: 6,
};

export class OutputError extends Error {
  /**
   * @param {'empty'|'not-json'|'truncated'|'wrong-shape'|'no-usable-items'|'declined'} kind
   */
  constructor(kind, message) {
    super(message);
    this.name = 'OutputError';
    this.kind = kind;
  }
}

// ---------------- step 1: text -> JSON value ----------------

export function extractJson(text) {
  if (typeof text !== 'string' || !text.trim()) {
    throw new OutputError('empty', 'The AI returned an empty response.');
  }
  let t = text.trim();

  // ```json ... ```  (closing fence optional, in case the output was cut off)
  const fence = t.match(/```(?:json|JSON)?\s*([\s\S]*?)(?:```|$)/);
  if (fence && fence[1].trim()) t = fence[1].trim();

  const attempt = (s) => {
    try {
      return { ok: true, value: JSON.parse(s) };
    } catch {
      return { ok: false };
    }
  };

  let r = attempt(t);
  if (r.ok) return r.value;

  // Prose before/after the object: take the outermost {...}
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start !== -1 && end > start) {
    r = attempt(t.slice(start, end + 1));
    if (r.ok) return r.value;
    // Common small-model mistake: trailing commas
    r = attempt(t.slice(start, end + 1).replace(/,\s*([}\]])/g, '$1'));
    if (r.ok) return r.value;
  }

  if (start !== -1 && !looksBalanced(t.slice(start))) {
    throw new OutputError('truncated', 'The AI response was cut off before it finished.');
  }
  throw new OutputError('not-json', 'The AI response wasn’t valid JSON.');
}

/** Rough check for "the model stopped mid-object" vs "the model wrote broken JSON". */
function looksBalanced(s) {
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inString) {
      if (c === '\\') i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === '{' || c === '[') depth++;
    else if (c === '}' || c === ']') depth--;
  }
  return depth <= 0 && !inString;
}

// ---------------- step 2: JSON value -> StudySet ----------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Accept strings and numbers, collapse whitespace, cap length. Anything else -> ''. */
function text(v, max) {
  if (typeof v === 'number' && Number.isFinite(v)) v = String(v);
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const firstDefined = (obj, keys) => {
  for (const k of keys) if (obj[k] !== undefined) return obj[k];
  return undefined;
};

function normalizeCard(raw) {
  if (!isObj(raw)) return null;
  const front = text(firstDefined(raw, ['front', 'term', 'question', 'prompt', 'q']), LIMITS.cardText);
  const back = text(firstDefined(raw, ['back', 'definition', 'answer', 'a']), LIMITS.cardText);
  return front && back ? { front, back } : null;
}

function normalizeQuestion(raw) {
  if (!isObj(raw)) return null;
  const question = text(firstDefined(raw, ['question', 'prompt', 'q', 'text']), LIMITS.question);
  const rawOptions = firstDefined(raw, ['options', 'choices', 'answers']);
  if (!question || !Array.isArray(rawOptions)) return null;

  const original = rawOptions.map((o) => text(isObj(o) ? firstDefined(o, ['text', 'label', 'option']) : o, LIMITS.option));

  // Work out the correct option's TEXT first, so de-duplicating options can't shift the index.
  let correct = '';
  const idx = firstDefined(raw, ['answerIndex', 'correctIndex', 'answer_index', 'correct']);
  const idxNum = typeof idx === 'string' && /^\d+$/.test(idx.trim()) ? Number(idx) : idx;
  if (Number.isInteger(idxNum) && idxNum >= 0 && idxNum < original.length) {
    correct = original[idxNum];
  } else {
    const ans = text(firstDefined(raw, ['answer', 'correctAnswer', 'correct_answer']), LIMITS.option);
    if (/^[A-F]$/i.test(ans)) {
      correct = original[ans.toUpperCase().charCodeAt(0) - 65] ?? ''; // "B" -> index 1
    } else if (ans) {
      correct = original.find((o) => o.toLowerCase() === ans.toLowerCase()) ?? '';
    }
  }
  if (!correct) return null;

  const options = [];
  const seen = new Set();
  for (const o of original) {
    const key = o.toLowerCase();
    if (o && !seen.has(key)) {
      seen.add(key);
      options.push(o);
    }
  }
  if (options.length < LIMITS.minOptions) return null;
  const trimmed = options.slice(0, LIMITS.maxOptions);
  if (!trimmed.includes(correct)) trimmed[trimmed.length - 1] = correct; // never drop the right answer

  return {
    question,
    options: trimmed,
    answerIndex: trimmed.indexOf(correct),
    explanation: text(firstDefined(raw, ['explanation', 'reason', 'why']), LIMITS.explanation),
  };
}

function dedupeBy(items, keyFn) {
  const seen = new Set();
  return items.filter((it) => {
    const k = keyFn(it).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * @returns {{ set: StudySet, warnings: string[] }}
 */
export function validateStudySet(value) {
  // Some models wrap the payload: { "data": {...} } or { "studySet": {...} }
  if (isObj(value) && !('cards' in value) && !('quiz' in value)) {
    const inner = firstDefined(value, ['data', 'studySet', 'study_set', 'result']);
    if (isObj(inner)) value = inner;
  }

  if (!isObj(value)) {
    throw new OutputError('wrong-shape', 'The AI returned data in an unexpected format.');
  }

  const rawCards = firstDefined(value, ['cards', 'flashcards', 'flashCards']);
  const rawQuiz = firstDefined(value, ['quiz', 'questions', 'mcqs']);

  if (!Array.isArray(rawCards) && !Array.isArray(rawQuiz)) {
    if (typeof value.error === 'string' && value.error.trim()) {
      throw new OutputError('declined', value.error.trim());
    }
    throw new OutputError('wrong-shape', 'The AI response was missing the flashcards and quiz.');
  }

  const cardsIn = Array.isArray(rawCards) ? rawCards : [];
  const quizIn = Array.isArray(rawQuiz) ? rawQuiz : [];

  const cardsValid = cardsIn.map(normalizeCard).filter(Boolean);
  const quizValid = quizIn.map(normalizeQuestion).filter(Boolean);
  const cards = dedupeBy(cardsValid, (c) => c.front).slice(0, LIMITS.maxCards);
  const quiz = dedupeBy(quizValid, (q) => q.question).slice(0, LIMITS.maxQuestions);

  if (!cards.length && !quiz.length) {
    throw new OutputError('no-usable-items', 'The AI response didn’t contain any complete flashcards or questions.');
  }

  const warnings = [];
  const badCards = cardsIn.length - cardsValid.length;
  const dupCards = cardsValid.length - cards.length;
  const badQs = quizIn.length - quizValid.length;
  const dupQs = quizValid.length - quiz.length;
  if (badCards) warnings.push(`Skipped ${plural(badCards, 'incomplete flashcard')}.`);
  if (dupCards) warnings.push(`Removed ${plural(dupCards, 'duplicate flashcard')}.`);
  if (badQs) warnings.push(`Skipped ${plural(badQs, 'broken quiz question')} (missing options or no valid answer).`);
  if (dupQs) warnings.push(`Removed ${plural(dupQs, 'duplicate question')}.`);
  if (!cards.length) warnings.push('No flashcards came back. Only the quiz is available.');
  if (!quiz.length) warnings.push('No quiz questions came back. Only flashcards are available.');

  return {
    set: {
      title: text(value.title, LIMITS.title) || 'Study set',
      cards: cards.map((c, i) => ({ id: `c${i}`, ...c })),
      quiz: quiz.map((q, i) => ({ id: `q${i}`, ...q })),
    },
    warnings,
  };
}

/** Convenience: raw model text -> { set, warnings }. Throws OutputError. */
export function parseStudySet(rawText) {
  return validateStudySet(extractJson(rawText));
}

/** The shape we send back to the model when refining (no ids, nothing UI-specific). */
export function toModelShape(set) {
  return {
    title: set.title,
    cards: set.cards.map(({ front, back }) => ({ front, back })),
    quiz: set.quiz.map(({ question, options, answerIndex, explanation }) => ({ question, options, answerIndex, explanation })),
  };
}
