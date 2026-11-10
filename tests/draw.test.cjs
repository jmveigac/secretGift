const { test } = require('node:test');
const assert = require('node:assert/strict');
const { drawParticipants } = require('../build/domain/draw');
const { createNewSecretGiftList } = require('../build/drawParticipants');
const participants = ['A', 'B', 'C'].map(name => ({ name, email: `${name}@example.invalid`, lastGift: '' }));
test('domain preserves assignments, uniqueness and input; CLI export still works', () => {
  const original = structuredClone(participants);
  const result = drawParticipants(participants, () => 0);
  assert.equal(new Set(result.map(p => p.lastGift)).size, 3);
  result.forEach((p, i) => assert.notEqual(p.lastGift, participants[i].name));
  assert.deepEqual(participants, original);
  assert.equal(createNewSecretGiftList(participants).length, 3);
});
test('previous gifts are excluded and impossible draws fail finitely', () => {
  const previous = participants.map((p, i) => ({ ...p, lastGift: participants[(i + 2) % 3].name }));
  const result = drawParticipants(previous, () => 0);
  result.forEach((p, i) => assert.notEqual(p.lastGift, previous[i].lastGift));
  assert.throws(() => drawParticipants(previous, max => max - 1), /Unable to create/);
  assert.throws(() => drawParticipants([], () => 0), /At least two/);
  assert.throws(() => drawParticipants([participants[0], participants[0]], () => 0), /unique/);
});
