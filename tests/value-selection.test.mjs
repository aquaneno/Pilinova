import test from 'node:test';
import assert from 'node:assert/strict';
import {ValueSelection, uniqueValues} from '../public/value-selection.mjs';

const values = count => Array.from({length: count}, (_, i) => `Wert ${i + 1}`);
function random(seed) {
  return () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
}
function chooseRound(exercise) {
  while (exercise.phase === 'choose') assert.equal(exercise.choose(exercise.pair[0]), true);
}

test('each value appears once per round, odd counts have exactly one bye, only selected values advance', () => {
  for (let count = 2; count <= 200; count++) {
    const exercise = new ValueSelection(values(count), random(count));
    let expected = exercise.values;
    while (exercise.phase !== 'complete') {
      const all = [...exercise.pairs.flat(), ...(exercise.bye === null ? [] : [exercise.bye])];
      assert.equal(all.length, expected.length);
      assert.equal(new Set(all).size, expected.length);
      assert.deepEqual(new Set(all), new Set(expected));
      assert.equal(exercise.bye !== null, expected.length % 2 === 1);
      chooseRound(exercise);
      for (const value of exercise.rejected.slice(0, 2)) assert.ok(exercise.toggleRestored(value));
      expected = exercise.selected;
      assert.ok(exercise.continue());
      assert.ok(exercise.round < 20, 'rounds must converge');
    }
    assert.ok(exercise.selected.length <= 8);
    assert.deepEqual(exercise.selected, expected);
  }
});

test('pairs are shuffled without modifying the source list', () => {
  const items = values(20);
  const a = new ValueSelection(items, random(1));
  const b = new ValueSelection(items, random(2));
  assert.notDeepEqual(a.pairs, b.pairs);
  assert.deepEqual(items, values(20));
});

test('only two rejected values can be restored; deselection frees a place', () => {
  const exercise = new ValueSelection(values(20), random(1));
  assert.equal(exercise.toggleRestored(exercise.pair[0]), false);
  chooseRound(exercise);
  const [a, b, c] = exercise.rejected;
  assert.ok(exercise.toggleRestored(a));
  assert.ok(exercise.toggleRestored(b));
  assert.equal(exercise.toggleRestored(c), false);
  assert.equal(exercise.toggleRestored(exercise.winners[0]), false);
  assert.ok(exercise.toggleRestored(a));
  assert.ok(exercise.toggleRestored(c));
  assert.deepEqual([...exercise.restored], [b, c]);
});

test('review always precedes completion and restores can trigger another round', () => {
  const exercise = new ValueSelection(values(16), random(1));
  assert.equal(exercise.continue(), false);
  assert.equal(exercise.choose('unbekannt'), false);
  chooseRound(exercise);
  assert.equal(exercise.phase, 'review');
  assert.equal(exercise.selected.length, 8);
  exercise.toggleRestored(exercise.rejected[0]);
  exercise.continue();
  assert.equal(exercise.phase, 'choose');
  assert.equal(exercise.round, 2);
  assert.equal(exercise.restored.size, 0);
  chooseRound(exercise);
  exercise.continue();
  assert.equal(exercise.phase, 'complete');
  assert.equal(exercise.choose(exercise.values[0]), false);
  assert.equal(exercise.continue(), false);
});

test('eight winners can finish without restoring; small starting lists still have a round', () => {
  for (const count of [2, 3, 8, 16]) {
    const exercise = new ValueSelection(values(count), random(count));
    assert.equal(exercise.phase, 'choose');
    chooseRound(exercise);
    exercise.continue();
    assert.equal(exercise.phase, 'complete');
    assert.ok(exercise.selected.length <= 8);
  }
});

test('empty and duplicate values cannot create self comparisons', () => {
  assert.deepEqual(uniqueValues([' Mut ', 'mut', '', '  ', 'MUT', 'Freude', 'Ｍｕｔ']), ['Mut', 'Freude']);
  assert.throws(() => new ValueSelection([]));
  assert.throws(() => new ValueSelection(['Mut', 'mut']));
  const exercise = new ValueSelection([' Mut ', 'mut', 'Freude']);
  assert.equal(exercise.pairs.length, 1);
  assert.notEqual(...exercise.pair);
});
