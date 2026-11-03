// Research-only preflight for synthetic payment-event classification.
// It does NOT parse STORES CSV, prove payout membership, calculate bank deposits,
// or authorize journal import. Evidence strings are assertions, not verified facts.
const NON_CHARGE_EVENTS = new Set([
  'booking_created', 'membership_enrolled', 'pass_redeemed', 'subscription_visit'
]);
const VALID_EVENTS = new Set([...NON_CHARGE_EVENTS, 'card_charge', 'onsite_payment', 'card_charge_failed']);
const review = reason => ({decision: 'NEEDS_MANUAL_REVIEW', reason});
const excluded = reason => ({decision: 'NOT_ONLINE_PAYMENT', reason});

export function classifyPaymentEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) return review('INVALID_EVENT');
  if (!VALID_EVENTS.has(event.eventType)) return review('UNKNOWN_EVENT_TYPE');
  if (NON_CHARGE_EVENTS.has(event.eventType)) return excluded('NO_NEW_PAYMENT_FROM_USAGE_OR_BOOKING');
  if (event.eventType === 'onsite_payment') return excluded('ONSITE_PAYMENT_IS_SEPARATE_CHANNEL');
  if (event.eventType === 'card_charge_failed') return excluded('FAILED_CARD_CHARGE');
  if (event.paymentChannel !== 'online_card') return review('UNVERIFIED_PAYMENT_CHANNEL');
  if (event.paymentStatus === 'failed') return excluded('FAILED_CARD_CHARGE');
  if (event.paymentStatus !== 'captured') return review('CARD_CAPTURE_UNVERIFIED');
  if (!Number.isSafeInteger(event.amountYen) || event.amountYen <= 0) return review('INVALID_AMOUNT');
  if (typeof event.chargeEvidenceRef !== 'string' || !event.chargeEvidenceRef.trim()) {
    return review('MISSING_CHARGE_EVIDENCE_REF');
  }
  return {decision: 'PAYMENT_CANDIDATE_ONLY', reason: 'PAYOUT_AND_BANK_MATCH_UNVERIFIED'};
}

export function classifyPaymentEvents(events) {
  if (!Array.isArray(events)) throw new TypeError('EVENTS_MUST_BE_ARRAY');
  const seen = new Set();
  return events.map(event => {
    const id = event?.eventId;
    if (typeof id !== 'string' || !id.trim()) return review('MISSING_EVENT_ID');
    if (seen.has(id)) return review('DUPLICATE_EVENT_ID');
    seen.add(id);
    return classifyPaymentEvent(event);
  });
}
