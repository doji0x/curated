export function formatClaimSol(value) {
  if (!/^\d+$/.test(String(value))) return 'Unavailable';
  const amount = BigInt(value);
  const fraction = String(amount % 1000000000n).padStart(9, '0').replace(/0+$/, '');
  return `${amount / 1000000000n}${fraction ? `.${fraction}` : ''} SOL`;
}

export function claimUiState({ data, result, signature = '', submitting = false, recovering = false, refreshing = false, statusError = false, needsRefresh = false }) {
  const trackedSignature = data.pendingRecord?.signature || signature || result?.record?.signature || result?.signature || '';
  const receipt = [data.trackedRecord, data.pendingRecord, ...(data.records || []), result?.record].find(row => row?.signature === trackedSignature);
  const verified = data.claimUiVersion === 1 && data.signerVerified === true && data.purchasesPaused === true;
  const pending = data.hasPending || receipt?.status === 'pending' || Boolean(trackedSignature && !receipt);
  const locked = Boolean(data.state?.locked);
  const amount = data.unclaimedSol;
  const hasRewards = /^\d+$/.test(String(amount)) && BigInt(amount) > 0n;
  let blockedReason = '';
  if (submitting) blockedReason = recovering ? 'Checking and retrying the saved claim…' : 'Preparing and submitting your claim…';
  else if (statusError || needsRefresh) blockedReason = 'Refresh status successfully before taking another action. The last request may still have reached the server.';
  else if (refreshing) blockedReason = 'Refreshing wallet and receipt status…';
  else if (!verified) blockedReason = 'Claim controls require the updated backend and a verified treasury wallet. Refresh after the backend is updated.';
  else if (locked) blockedReason = 'Another worker is checking or submitting a transaction. Waiting for it to finish.';
  else if (pending) blockedReason = 'A saved transaction is awaiting finalization. New claims are paused.';
  else if (data.claimError || !data.claim || data.claim.wallet !== data.wallet) blockedReason = 'Reward details are unavailable. Refresh before claiming.';
  else if (!hasRewards) blockedReason = 'No SOL creator rewards are currently available to claim.';

  let phase = 'ready', message = 'Ready to claim available creator rewards.';
  if (receipt?.status === 'confirmed') { phase = 'confirmed'; message = receipt.claimVersion === 1 ? `Claim finalized: ${formatClaimSol(receipt.totalAccrued)} received by the treasury.` : 'Saved transaction finalized. See its receipt in the history below.'; }
  else if (receipt?.status === 'failed') { phase = 'failed'; message = receipt.error || 'The claim failed. No rewards were recorded.'; }
  else if (pending) { phase = 'pending'; message = 'Waiting for the saved transaction’s finalized receipt.'; }
  else if (result?.skipped) { phase = 'skipped'; message = result.reason; }
  if (submitting) { phase = 'submitting'; message = blockedReason; }
  const canRecover = verified && !submitting && !refreshing && !statusError && !needsRefresh && !locked && receipt?.status === 'pending' && receipt.claimVersion === 1;
  return { phase, message, receipt, signature: trackedSignature, blockedReason, canClaim: !blockedReason, canRecover };
}
