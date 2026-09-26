import test from 'node:test';
import assert from 'node:assert/strict';
import { claimUiState, formatClaimSol } from '../../src/components/buyback/claimUiState.js';

const ready = () => ({ claimUiVersion: 1, signerVerified: true, purchasesPaused: true, wallet: 'treasury',
  claim: { wallet: 'treasury' }, unclaimedSol: '5000000', state: { locked: false }, hasPending: false, records: [] });
const pending = () => ({ signature: 'saved', claimVersion: 1, status: 'pending' });

test('UI allows a verified claim below the old buyback minimum', () => {
  const ui = claimUiState({ data: ready() });
  assert.equal(ui.canClaim, true); assert.equal(ui.phase, 'ready');
});
test('UI blocks empty or unavailable rewards, old backends and unverified wallets', () => {
  for (const patch of [{ unclaimedSol: '0' }, { unclaimedSol: null }, { unclaimedSol: 'invalid' }, { signerVerified: false },
    { claimUiVersion: undefined }, { purchasesPaused: false }, { claimError: 'RPC failed' }, { claim: null }, { claim: { wallet: 'other' } }]) {
    assert.equal(claimUiState({ data: { ...ready(), ...patch } }).canClaim, false);
  }
});
test('UI blocks actions during submission, refresh, stale errors and worker locks', () => {
  for (const patch of [{ submitting: true }, { refreshing: true }, { statusError: true }, { needsRefresh: true }]) {
    const ui = claimUiState({ data: { ...ready(), pendingRecord: pending(), hasPending: true }, ...patch });
    assert.equal(ui.canClaim, false); assert.equal(ui.canRecover, false);
  }
  const ui = claimUiState({ data: { ...ready(), state: { locked: true } } });
  assert.equal(ui.canClaim, false); assert.match(ui.blockedReason, /Another worker/);
  assert.doesNotMatch(ui.blockedReason, /saved transaction/);
});
test('UI follows submitted claims before the refreshed pending list arrives', () => {
  const ui = claimUiState({ data: ready(), result: { record: pending() } });
  assert.equal(ui.phase, 'pending'); assert.equal(ui.canClaim, false); assert.equal(ui.canRecover, true);
});
test('UI replaces submission text with finalized receipt amount or failure', () => {
  const result = { record: pending(), message: 'Waiting for finalization.' };
  for (const status of ['confirmed', 'failed']) {
    const data = { ...ready(), trackedRecord: { ...pending(), status, totalAccrued: '123456789', error: status === 'failed' ? 'Expired without landing.' : '' } };
    const ui = claimUiState({ data, result, signature: 'saved' });
    assert.equal(ui.phase, status); assert.equal(ui.canRecover, false);
    assert.match(ui.message, status === 'confirmed' ? /0\.123456789 SOL/ : /Expired/);
    assert.doesNotMatch(ui.message, /Waiting/);
  }
});
test('UI finds pending receipts on reload and while viewing older history pages', () => {
  const data = { ...ready(), pendingRecord: pending(), hasPending: true, records: [] };
  const ui = claimUiState({ data });
  assert.equal(ui.signature, 'saved'); assert.equal(ui.canRecover, true);
  data.pendingRecord = null; data.hasPending = false; data.trackedRecord = { ...pending(), status: 'confirmed', totalAccrued: '1' };
  assert.equal(claimUiState({ data, signature: 'saved' }).phase, 'confirmed');
});
test('a newer pending receipt takes priority over a previously finalized claim', () => {
  const data = { ...ready(), pendingRecord: pending(), trackedRecord: { signature: 'old', status: 'confirmed' }, hasPending: true };
  const ui = claimUiState({ data, signature: 'old' });
  assert.equal(ui.signature, 'saved'); assert.equal(ui.phase, 'pending'); assert.equal(ui.canRecover, true);
});
test('recovery remains available without new rewards but never for historical purchases', () => {
  const data = { ...ready(), pendingRecord: pending(), hasPending: true, unclaimedSol: '0', claimError: 'Reward lookup unavailable' };
  assert.equal(claimUiState({ data }).canRecover, true);
  data.pendingRecord.claimVersion = undefined;
  const ui = claimUiState({ data });
  assert.equal(ui.canRecover, false); assert.equal(ui.canClaim, false);
});
test('a missing tracked receipt cannot enable a second claim', () => {
  const ui = claimUiState({ data: ready(), signature: 'unknown' });
  assert.equal(ui.phase, 'pending'); assert.equal(ui.canClaim, false); assert.equal(ui.canRecover, false);
});
test('SOL displays preserve lamports and distinguish unavailable from zero', () => {
  assert.equal(formatClaimSol('1'), '0.000000001 SOL');
  assert.equal(formatClaimSol('9007199254740993'), '9007199.254740993 SOL');
  assert.equal(formatClaimSol('0'), '0 SOL');
  assert.equal(formatClaimSol(null), 'Unavailable');
});
