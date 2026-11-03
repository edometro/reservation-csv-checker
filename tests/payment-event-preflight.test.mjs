import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyPaymentEvent, classifyPaymentEvents} from '../src/payment-event-preflight.mjs';
const charge = (eventId, amountYen) => ({eventId, eventType:'card_charge',
  paymentChannel:'online_card', paymentStatus:'captured', amountYen,
  chargeEvidenceRef:'synthetic:test:' + eventId});
const event = (eventId, eventType) => ({eventId, eventType});
const decisions = events => classifyPaymentEvents(events).map(x => x.decision);

test('A: full first-month charge counts once, later membership booking does not', () => {
  assert.deepEqual(decisions([charge('a1',6000),event('a2','subscription_visit')]),
    ['PAYMENT_CANDIDATE_ONLY','NOT_ONLINE_PAYMENT']);
});
test('B: prorated first month and next-month full charge are separate candidates', () => {
  assert.deepEqual(decisions([charge('b1',2000),charge('b2',6000)]),
    ['PAYMENT_CANDIDATE_ONLY','PAYMENT_CANDIDATE_ONLY']);
});
test('C: enrollment without captured charge does not imply a bank deposit', () => {
  assert.deepEqual(decisions([event('c1','membership_enrolled'),event('c2','booking_created')]),
    ['NOT_ONLINE_PAYMENT','NOT_ONLINE_PAYMENT']);
});
test('D: pass purchase and pass redemption must not double count', () => {
  assert.deepEqual(decisions([charge('d1',12000),event('d2','pass_redeemed')]),
    ['PAYMENT_CANDIDATE_ONLY','NOT_ONLINE_PAYMENT']);
});
test('E: onsite membership payment never enters online payout candidates', () => {
  assert.deepEqual(decisions([event('e1','onsite_payment')]),['NOT_ONLINE_PAYMENT']);
});
test('F: failed card charge plus onsite collection does not produce an online candidate', () => {
  assert.deepEqual(decisions([event('f1','card_charge_failed'),event('f2','onsite_payment')]),
    ['NOT_ONLINE_PAYMENT','NOT_ONLINE_PAYMENT']);
});
test('G: three membership bookings do not imply three new charges', () => {
  assert.deepEqual(decisions(['g1','g2','g3'].map(id => event(id,'subscription_visit'))),
    Array(3).fill('NOT_ONLINE_PAYMENT'));
});
test('H: unknown channel, missing capture evidence and unknown event fail closed', () => {
  assert.deepEqual(decisions([{...charge('h1',6000),paymentChannel:'unknown'},
    {...charge('h2',6000),chargeEvidenceRef:''},event('h3','other')]),
    Array(3).fill('NEEDS_MANUAL_REVIEW'));
});
test('replayed event id cannot become a second payment candidate', () => {
  assert.deepEqual(decisions([charge('dup',6000),charge('dup',6000)]),
    ['PAYMENT_CANDIDATE_ONLY','NEEDS_MANUAL_REVIEW']);
});
test('missing event id and unsafe/negative amount fail closed', () => {
  assert.equal(classifyPaymentEvents([charge('',100)])[0].reason,'MISSING_EVENT_ID');
  assert.equal(classifyPaymentEvent(charge('n',-1)).decision,'NEEDS_MANUAL_REVIEW');
  assert.equal(classifyPaymentEvent(charge('u',Number.MAX_SAFE_INTEGER+1)).decision,'NEEDS_MANUAL_REVIEW');
});
test('pending card charge is not a payment candidate', () => {
  assert.equal(classifyPaymentEvent({...charge('p',100),paymentStatus:'pending'}).reason,
    'CARD_CAPTURE_UNVERIFIED');
});
test('positive candidate is not a verified payout, bank match, or accounting entry', () => {
  assert.deepEqual(classifyPaymentEvent(charge('ok',500)),
    {decision:'PAYMENT_CANDIDATE_ONLY',reason:'PAYOUT_AND_BANK_MATCH_UNVERIFIED'});
});
