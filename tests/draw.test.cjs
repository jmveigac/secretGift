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
  assert.equal(drawParticipants(previous, max => max - 1).length, 3);
  const impossible = participants.slice(0, 2).map((p, i) => ({ ...p, lastGift: participants[1 - i].name }));
  assert.throws(() => drawParticipants(impossible, () => 0), /Unable to create/);
  assert.throws(() => drawParticipants([], () => 0), /At least two/);
  assert.throws(() => drawParticipants([participants[0], participants[0]], () => 0), /unique/);
});

test('invalid domain data and normalized duplicates are rejected', () => {
 for (const value of [null, [{name: ' ', email:'bad', lastGift:''}, participants[1]], [participants[0], {...participants[1], name:' A  '}], [participants[0], {...participants[1], lastGift:'missing'}], [participants[0], {...participants[1], email:participants[0].email}]]) {
  assert.throws(() => drawParticipants(value, () => 0));
 }
});
test('matching agrees with exhaustive feasibility for every restriction at size four', () => {
 const people = ['A','B','C','D'].map(name => ({name,email:name+'@example.invalid',lastGift:''}));
 const feasible = (ps, i = 0, used = new Set()) => i === ps.length || ps.some(p => {
  if (used.has(p.name) || p.name === ps[i].name || p.name === ps[i].lastGift) return false;
  return feasible(ps, i+1, new Set([...used,p.name]));
 });
 for (let mask = 0; mask < 256; mask++) {
  let n=mask; const ps=people.map((p,i) => {const options=['',...people.filter((_,j)=>j!==i).map(p=>p.name)];const lastGift=options[n%4];n=Math.floor(n/4);return {...p,lastGift};});
  if (feasible(ps)) assert.equal(drawParticipants(ps, () => 0).length,4);
  else assert.throws(() => drawParticipants(ps, () => 0), /Unable/);
 }
});

test('CLI draw and mail construction do not invoke SMTP', () => {
 const nodemailer = require('nodemailer');
 const { createMailList } = require('../build/drawParticipants');
 const original = nodemailer.createTransport;
 let calls = 0;
 nodemailer.createTransport = () => { calls++; throw new Error('SMTP is forbidden in tests'); };
 try {
  const result = createNewSecretGiftList(participants);
  assert.equal(createMailList(result).length, participants.length);
  assert.equal(calls, 0);
 } finally { nodemailer.createTransport = original; }
});
