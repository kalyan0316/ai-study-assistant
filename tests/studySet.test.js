import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStudySet, OutputError } from '../src/lib/studySet.js';

const good = {
  title: 'Cells',
  cards: [{ front: 'Mitochondria', back: 'Makes ATP' }],
  quiz: [{ question: 'Powerhouse of the cell?', options: ['Nucleus', 'Mitochondria', 'Ribosome', 'Golgi'], answerIndex: 1, explanation: 'It makes ATP.' }],
};

const kindOf = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof OutputError, `expected OutputError, got ${e}`);
    return e.kind;
  }
  assert.fail('expected an error');
};

test('parses clean JSON', () => {
  const { set, warnings } = parseStudySet(JSON.stringify(good));
  assert.equal(set.title, 'Cells');
  assert.equal(set.cards.length, 1);
  assert.equal(set.quiz[0].answerIndex, 1);
  assert.deepEqual(warnings, []);
});

test('strips code fences and surrounding prose', () => {
  const { set } = parseStudySet(`Here you go!\n\`\`\`json\n${JSON.stringify(good)}\n\`\`\`\nEnjoy`);
  assert.equal(set.cards.length, 1);
});

test('finds the object inside prose without fences', () => {
  const { set } = parseStudySet(`Sure: ${JSON.stringify(good)} hope that helps`);
  assert.equal(set.quiz.length, 1);
});

test('tolerates trailing commas', () => {
  const { set } = parseStudySet('{"title":"T","cards":[{"front":"a","back":"b"},],}');
  assert.equal(set.cards.length, 1);
});

test('empty, garbage, truncated', () => {
  assert.equal(kindOf(() => parseStudySet('')), 'empty');
  assert.equal(kindOf(() => parseStudySet('   ')), 'empty');
  assert.equal(kindOf(() => parseStudySet(null)), 'empty');
  assert.equal(kindOf(() => parseStudySet('I cannot help with that')), 'not-json');
  assert.equal(kindOf(() => parseStudySet('{"title": "x", "cards": [{"front": "a", "ba')), 'truncated');
});

test('wrong shape and model refusal', () => {
  assert.equal(kindOf(() => parseStudySet('[1,2,3]')), 'wrong-shape');
  assert.equal(kindOf(() => parseStudySet('"just a string"')), 'wrong-shape');
  assert.equal(kindOf(() => parseStudySet('{"flashcards": "some text"}')), 'wrong-shape');
  assert.equal(kindOf(() => parseStudySet('{"error": "Not study material"}')), 'declined');
});

test('rejects when nothing is usable', () => {
  assert.equal(kindOf(() => parseStudySet('{"cards":[{"front":"no back"}],"quiz":[]}')), 'no-usable-items');
});

test('drops bad items but keeps good ones, with warnings', () => {
  const { set, warnings } = parseStudySet(
    JSON.stringify({
      cards: [...good.cards, { front: 'x' }, { back: 'y' }, 'string', good.cards[0]],
      quiz: [
        ...good.quiz,
        { question: 'Out of range', options: ['a', 'b'], answerIndex: 5 },
        { question: 'One option', options: ['a'], answerIndex: 0 },
        { question: 'No options', answerIndex: 0 },
      ],
    }),
  );
  assert.equal(set.cards.length, 1);
  assert.equal(set.quiz.length, 1);
  assert.equal(set.title, 'Study set');
  assert.ok(warnings.some((w) => w.includes('3 incomplete flashcards')));
  assert.ok(warnings.some((w) => w.includes('1 duplicate flashcard')));
  assert.ok(warnings.some((w) => w.includes('3 broken quiz questions')));
});

test('accepts alternative field names and answer formats', () => {
  const { set } = parseStudySet(
    JSON.stringify({
      flashcards: [{ term: 'H2O', definition: 'Water' }],
      questions: [
        { question: 'Color of sky?', choices: ['Red', 'Blue', 'Green'], answer: 'blue' },
        { question: 'Letter answer', options: ['w', 'x', 'y', 'z'], answer: 'C' },
        { question: 'String index', options: ['w', 'x', 'y', 'z'], answerIndex: '3' },
      ],
    }),
  );
  assert.deepEqual(set.cards[0], { id: 'c0', front: 'H2O', back: 'Water' });
  assert.equal(set.quiz[0].options[set.quiz[0].answerIndex], 'Blue');
  assert.equal(set.quiz[1].options[set.quiz[1].answerIndex], 'y');
  assert.equal(set.quiz[2].options[set.quiz[2].answerIndex], 'z');
});

test('duplicate options do not shift the correct answer', () => {
  const { set } = parseStudySet(
    JSON.stringify({ quiz: [{ question: 'Q', options: ['A', 'A', 'B', 'C'], answerIndex: 3 }] }),
  );
  assert.deepEqual(set.quiz[0].options, ['A', 'B', 'C']);
  assert.equal(set.quiz[0].options[set.quiz[0].answerIndex], 'C');
});

test('unwraps a nested payload and coerces numbers', () => {
  const { set } = parseStudySet(JSON.stringify({ data: { cards: [{ front: '2+2', back: 4 }] } }));
  assert.equal(set.cards[0].back, '4');
});
