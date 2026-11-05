import test from 'node:test';
import assert from 'node:assert/strict';
import {ValueSelection, ValuePyramid, uniqueValues} from '../public/value-selection.mjs';

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

test('personal method converges to exactly eight for all supported sizes and restore strategies', () => {
  for (const restoreBetweenRounds of [false, true]) {
    for (let count = 8; count <= 200; count++) {
      const exercise = new ValueSelection(values(count), random(count), {exactEight: true});
      let expected = exercise.values;
      while (exercise.phase === 'choose') {
        const all = [...exercise.pairs.flat(), ...(exercise.bye === null ? [] : [exercise.bye])];
        assert.deepEqual(new Set(all), new Set(expected));
        assert.equal(all.length, new Set(all).size);
        chooseRound(exercise);
        const limit = exercise.isFinalRound ? 8 - exercise.selected.length : 2;
        assert.equal(exercise.restoreLimit, limit);
        if (exercise.isFinalRound && limit) {
          assert.equal(exercise.continue(), false, 'cannot finish with too few values');
        }
        if (exercise.isFinalRound || restoreBetweenRounds) {
          exercise.rejected.slice(0, limit).forEach(value => assert.ok(exercise.toggleRestored(value)));
        }
        expected = exercise.selected;
        assert.ok(exercise.continue());
        assert.ok(exercise.round < 20);
      }
      assert.equal(exercise.phase, 'sort');
      assert.equal(exercise.selected.length, 8);
      assert.deepEqual(new Set(exercise.pyramid.values), new Set(expected));
    }
  }
});

test('final round can restore four values, prevents overflow and allows corrections', () => {
  const exercise = new ValueSelection(values(8), random(1), {exactEight: true});
  chooseRound(exercise);
  assert.equal(exercise.restoreLimit, 4);
  exercise.rejected.forEach(value => assert.ok(exercise.toggleRestored(value)));
  assert.ok(exercise.canContinue);
  assert.ok(exercise.toggleRestored(exercise.rejected[0]));
  assert.equal(exercise.canContinue, false);
  assert.equal(exercise.continue(), false);
  assert.ok(exercise.toggleRestored(exercise.rejected[0]));
  assert.ok(exercise.continue());
  assert.equal(exercise.finish(), false, 'sorting is mandatory');
  assert.equal(exercise.toggleRestored(exercise.rejected[0]), false);

  const sixteen = new ValueSelection(values(16), random(1), {exactEight: true});
  chooseRound(sixteen);
  assert.equal(sixteen.restoreLimit, 0);
  assert.equal(sixteen.toggleRestored(sixteen.rejected[0]), false);
  assert.ok(sixteen.continue());
});

test('personal method rejects lists too short after deduplication', () => {
  for (let count = 0; count < 8; count++) {
    assert.throws(() => new ValueSelection(values(count), Math.random, {exactEight: true}), /acht/);
  }
  assert.throws(() => new ValueSelection([...values(7), 'WERT 1'], Math.random, {exactEight: true}));
});

test('pyramid assigns eight unique values across 1/3/4 and permits changes', () => {
  assert.throws(() => new ValuePyramid(values(7)));
  assert.throws(() => new ValuePyramid(values(9)));
  const exercise = new ValueSelection(values(16), random(1), {exactEight: true});
  chooseRound(exercise);
  exercise.continue();
  const pyramid = exercise.pyramid;
  const [lead, a, b, c, d] = pyramid.values;
  assert.equal(pyramid.toggleEfficacy(a), false);
  assert.equal(pyramid.chooseLead('unknown'), false);
  assert.ok(pyramid.chooseLead(lead));
  assert.equal(pyramid.toggleEfficacy(lead), false);
  [a, b, c].forEach(value => assert.ok(pyramid.toggleEfficacy(value)));
  assert.equal(pyramid.toggleEfficacy(d), false);
  assert.equal(pyramid.toggleEfficacy('unknown'), false);
  assert.ok(pyramid.ready);
  assert.equal(pyramid.foundation.length, 4);
  assert.deepEqual(new Set([pyramid.lead, ...pyramid.efficacy, ...pyramid.foundation]), new Set(exercise.selected));
  assert.ok(pyramid.chooseLead(a));
  assert.equal(pyramid.ready, false);
  assert.ok(!pyramid.efficacy.has(a));
  assert.equal(exercise.finish(), false);
  assert.ok(pyramid.toggleEfficacy(lead));
  assert.ok(pyramid.toggleEfficacy(b));
  assert.equal(pyramid.ready, false);
  assert.ok(pyramid.toggleEfficacy(d));
  assert.ok(pyramid.ready);
  assert.ok(exercise.finish());
  assert.equal(exercise.phase, 'complete');
  assert.equal(exercise.finish(), false);
});
