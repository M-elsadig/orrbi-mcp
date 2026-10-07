import { test } from 'node:test';
import assert from 'node:assert/strict';
import { type Requirement, checkAnswers, flagNotes, forService, requirementOut } from '../src/lib/requirements.js';
import { redact } from '../src/lib/errors.js';

const SVC = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NOTE = 'Studio 11 will call you before your session.';

const q = (id: string, extra: Partial<Requirement> = {}): Requirement => ({
  id, service_id: null, kind: 'question', key: id, text: `Question ${id}?`, text_ar: null,
  flag_answer: true, flag_note: NOTE, flag_note_ar: null, ...extra
});
const notice: Requirement = {
  id: 'n1', service_id: null, kind: 'notice', key: 'n1', text: 'I agree to arrive 10 minutes early.', text_ar: null,
  flag_answer: null, flag_note: null, flag_note_ar: null
};

test('every question needs a yes or no', () => {
  const reqs = [q('q1'), q('q2')];
  const r = checkAnswers(reqs, [{ id: 'q1', answer: false }]);
  assert.equal(r.ok, false);
  assert.deepEqual(!r.ok && r.missing.map((m) => m.id), ['q2']);
  assert.equal(checkAnswers(reqs, undefined).ok, false);
});

test('all "No" passes with nothing flagged', () => {
  const r = checkAnswers([q('q1'), q('q2')], [{ id: 'q1', answer: false }, { id: 'q2', answer: false }]);
  assert.deepEqual(r, { ok: true, flagged: [] });
});

test('a "Yes" still books, flagged with its note', () => {
  const reqs = [q('q1'), q('q2')];
  const r = checkAnswers(reqs, [{ id: 'q1', answer: true }, { id: 'q2', answer: false }]);
  assert.equal(r.ok, true);
  assert.deepEqual(r.ok && r.flagged.map((f) => f.id), ['q1']);
  /* two flagged answers with the same note say it once */
  const both = checkAnswers(reqs, [{ id: 'q1', answer: true }, { id: 'q2', answer: true }]);
  assert.deepEqual(both.ok && flagNotes(both.flagged), [NOTE]);
});

test('a notice must be agreed to, not refused', () => {
  assert.equal(checkAnswers([notice], [{ id: 'n1', answer: false }]).ok, false);
  assert.deepEqual(checkAnswers([notice], [{ id: 'n1', answer: true }]), { ok: true, flagged: [] });
});

test('an answer to something that is not a requirement here is refused', () => {
  const r = checkAnswers([q('q1')], [{ id: 'q1', answer: false }, { id: 'zzz', answer: true }]);
  assert.deepEqual(r, { ok: false, reason: 'unknown', missing: [] });
});

test('no requirements: nothing to answer (Aflete)', () => {
  assert.deepEqual(checkAnswers([], undefined), { ok: true, flagged: [] });
  assert.deepEqual(checkAnswers([], []), { ok: true, flagged: [] });
});

test('a service gets its own requirements plus the business-wide ones', () => {
  const reqs = [q('all'), q('mine', { service_id: SVC }), q('theirs', { service_id: OTHER })];
  assert.deepEqual(forService(reqs, SVC).map((r) => r.id), ['all', 'mine']);
});

test('what the model sees: flag details only for questions that have one', () => {
  assert.deepEqual(requirementOut(notice), { id: 'n1', kind: 'notice', text: notice.text, text_ar: null });
  assert.equal(requirementOut(q('q1')).flag_answer, true);
});

test('error logs never keep the answers', () => {
  const ctx = redact({ customer_phone: '+97455123456', requirements: [{ id: 'q1', answer: true }] });
  assert.equal(ctx.requirements, '[1 answers]');
  assert.equal(ctx.customer_phone, '…456');
});
