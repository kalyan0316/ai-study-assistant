/**
 * Mock "model" used when no API key is set, plus failure simulation.
 * Simulation lets you demo (and test) every bad-output path the UI handles
 * without waiting for a real model to misbehave.
 */
import { UpstreamError } from './llm.js';

export const SIMULATIONS = [
  'none',
  'slow',
  'fenced',
  'partial',
  'malformed',
  'wrong-shape',
  'empty',
  'declined',
  'timeout',
  'rate-limit',
  'server-error',
];

const FALLBACK_FACTS = [
  ['Evaporation', 'Liquid water turning into water vapour, mostly driven by the sun’s heat.'],
  ['Condensation', 'Water vapour cooling into tiny droplets that form clouds.'],
  ['Precipitation', 'Water falling from clouds as rain, snow, sleet or hail.'],
  ['Transpiration', 'Water vapour released by plants through pores in their leaves.'],
  ['Runoff', 'Water flowing over land into rivers, lakes and oceans.'],
  ['Infiltration', 'Water soaking into the soil to become groundwater.'],
];

/** Pull "X is Y" / "X: Y" pairs out of the notes so mock output looks related to the input. */
function factsFromNotes(notes) {
  const facts = [];
  const sentences = notes.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  for (const s of sentences) {
    const m = s.match(/^(.{2,60}?)\s*(?::| - | is | are | means | refers to )\s*(.{5,200})$/i);
    if (m) facts.push([m[1].replace(/^(the|a|an)\s+/i, '').trim(), m[2].replace(/\.$/, '').trim()]);
    if (facts.length >= 12) break;
  }
  return facts;
}

export function buildMockSet(notes, cardCount, quizCount) {
  const facts = factsFromNotes(notes);
  for (const f of FALLBACK_FACTS) {
    if (facts.length >= Math.max(cardCount, 4)) break;
    facts.push(f);
  }

  const words = notes.replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  const title = words.length ? `${words.slice(0, 5).join(' ')}${words.length > 5 ? '…' : ''}` : 'Study set';
  const cards = facts.slice(0, cardCount).map(([front, back]) => ({ front, back }));

  const quiz = facts.slice(0, quizCount).map(([term, definition], i) => {
    const distractors = facts.filter((_, j) => j !== i).map(([t]) => t).slice(0, 3);
    const options = [term, ...distractors];
    // rotate so the right answer isn't always first
    const shift = i % options.length;
    const rotated = options.slice(shift).concat(options.slice(0, shift));
    return {
      question: `Which term matches: “${definition}”?`,
      options: rotated,
      answerIndex: rotated.indexOf(term),
      explanation: `${term}: ${definition.replace(/\.$/, '')}.`,
    };
  });

  return { title: `Sample set: ${title}`, cards, quiz };
}

const sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new UpstreamError('client-closed', 'Request cancelled.', 499, false));
    });
  });

/**
 * Returns `{ content }` like callLLM does, or throws UpstreamError.
 * `base` is the study set a healthy model would have produced.
 */
export async function simulate(kind, base, { signal } = {}) {
  await sleep(kind === 'slow' ? 9000 : 600, signal); // small delay so loading states are visible

  const good = JSON.stringify(base);
  switch (kind) {
    case 'fenced':
      return { content: `Sure! Here is your study set:\n\n\`\`\`json\n${JSON.stringify(base, null, 2)}\n\`\`\`\n\nGood luck!` };
    case 'partial':
      return {
        content: JSON.stringify({
          ...base,
          cards: [...base.cards, { front: 'Card with no back' }, { front: '', back: 'No front' }, base.cards[0]],
          quiz: [
            ...base.quiz,
            { question: 'Answer index out of range?', options: ['A', 'B', 'C', 'D'], answerIndex: 7 },
            { question: 'Only one option?', options: ['Yes'], answerIndex: 0 },
            { question: 'Answer given as text', options: ['Red', 'Green', 'Blue', 'Yellow'], answer: 'blue' },
          ],
        }),
      };
    case 'malformed':
      return { content: good.slice(0, Math.floor(good.length * 0.6)) }; // cut off mid-object
    case 'wrong-shape':
      return { content: JSON.stringify({ flashcards: 'Here are some flashcards about your topic!', count: 5 }) };
    case 'empty':
      return { content: '' };
    case 'declined':
      return { content: JSON.stringify({ error: 'The notes do not contain any material that can be turned into study questions.' }) };
    case 'timeout':
      throw new UpstreamError('timeout', 'The AI model took too long to respond.', 504, true);
    case 'rate-limit':
      throw new UpstreamError('rate-limited', 'The AI provider is rate-limiting requests. Wait a few seconds and retry.', 429, true);
    case 'server-error':
      throw new UpstreamError('upstream-error', 'The AI provider returned an error (500).', 502, true);
    default:
      return { content: good };
  }
}
