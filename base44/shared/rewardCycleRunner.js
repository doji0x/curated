import { Buffer } from 'node:buffer';
import { CLAIM_MINT, CLAIM_WALLET, claimAssert } from './creatorClaimsCore.js';
import { allWalletRecords, rewardLedger, assertRewardBudget } from './rewardCycleCore.js';

export function createRewardCycleRunner({ getBuybackState, acquireBuybackLock, releaseBuybackLock, prepareCreatorClaim, inspectClaim, prepareCycleStep, settleBuyback,
  now = () => Date.now(), wait = ms => new Promise(resolve => setTimeout(resolve, ms)), timeLimit = 210000 }) {
  return async function runRewardCycle(ctx) {
    const { db } = ctx;
    claimAssert(ctx.wallet.publicKey.toBase58() === CLAIM_WALLET, 'Unexpected reward-cycle wallet.');
    const locked = await acquireBuybackLock(db);
    if (!locked) return { skipped: true, reason: 'Another worker is processing this treasury.' };
    const patch = { lastRunAt: new Date(now()).toISOString(), lastError: '' };
    const deadline = now() + timeLimit;
    let claimedThisRun = false;
    const attempted = new Set();
    async function lease() {
      const state = await getBuybackState(db);
      claimAssert(state.lockToken === locked.lockToken && Date.parse(state.lockUntil) > now(), 'Worker lease expired or changed.');
      return state;
    }
    async function saveAndSend(prepared) {
      const [existing] = await db.BuybackRecord.filter({ wallet: CLAIM_WALLET, signature: prepared.signature }, 'created_date', 1);
      if (existing) return existing;
      const record = await db.BuybackRecord.create(prepared);
      const state = await lease();
      if (!state.automationEnabled) return record;
      try { await ctx.connection.sendRawTransaction(Buffer.from(prepared.signedTransaction, 'base64'), { skipPreflight: false, maxRetries: 2 }); }
      catch { /* The saved transaction is the only one that can be retried. */ }
      return record;
    }
    try {
      while (now() < deadline) {
        const state = await lease();
        claimAssert(!state.wallet || state.wallet === CLAIM_WALLET, 'Reward wallet changed.');
        const rows = await allWalletRecords(db);
        const pending = rows.filter(row => row.status === 'pending');
        if (pending.length) {
          for (const row of pending.slice(0, 10)) {
            const mayResend = state.automationEnabled === true && (row.cycleVersion === 1 || row.claimVersion === 1);
            await settleBuyback(ctx, row, mayResend);
          }
          const refreshed = await allWalletRecords(db);
          if (refreshed.some(row => row.status === 'pending')) {
            if (!state.automationEnabled || now() + 2000 >= deadline) return { pending: true, reason: 'Waiting for a saved transaction to finalize.' };
            await wait(1500); continue;
          }
          continue;
        }
        if (!state.automationEnabled || !state.rewardStartedAt) return { skipped: true, reason: 'Reward automation is paused.' };
        let ledger = rewardLedger(rows, state.rewardStartedAt);
        const active = await db.BurnRewardCycle.filter({ wallet: CLAIM_WALLET, status: { $ne: 'completed' } }, 'created_date', 2);
        claimAssert(active.length <= 1, 'Multiple active reward cycles require reconciliation.');
        let cycle = active[0];
        claimAssert(!cycle || (cycle.epoch === state.rewardStartedAt && cycle.mint === CLAIM_MINT), 'Unexpected cycle accounting epoch or mint.');
        // Prioritize tokens already bought. New claims cannot delay an unfinished burn.
        const purchased = cycle && rows.some(row => row.cycleId === cycle.id && row.cycleStep === 'buy' && row.status === 'confirmed');
        if (!claimedThisRun && (!cycle || (cycle.status === 'buy' && !purchased))) {
          claimedThisRun = true;
          const claim = await inspectClaim(ctx);
          claimAssert(claim.claimScope === 'mint' && claim.attributedMint === CLAIM_MINT, 'Only isolated Burn rewards can fund this automation.');
          const prepared = await prepareCreatorClaim({ ...ctx, rewardFloor: ledger.protected });
          if (!prepared.skipped) { await saveAndSend(prepared); continue; }
        }
        if (!cycle) {
          if (BigInt(ledger.available) === 0n) return { skipped: true, reason: 'No unspent verified reward allocation.' };
          cycle = await db.BurnRewardCycle.create({ wallet: CLAIM_WALLET, mint: CLAIM_MINT, epoch: state.rewardStartedAt, status: 'buy',
            budget: ledger.available, fundingSignatures: ledger.claimSignatures, createdAt: new Date(now()).toISOString(), tokensBought: '0', tokensBurned: '0' });
        }
        const step = cycle.status;
        claimAssert(['buy', 'burn', 'close'].includes(step), 'Unknown cycle stage.');
        const receipts = rows.filter(row => row.cycleVersion === 1 && row.cycleId === cycle.id && row.cycleStep === step);
        const confirmed = receipts.filter(row => row.status === 'confirmed');
        claimAssert(confirmed.length <= 1, 'Duplicate finalized cycle stage.');
        if (confirmed[0]) {
          const receipt = confirmed[0];
          const changes = step === 'buy' ? { status: 'burn', tokensBought: receipt.coinsReceived, spent: receipt.sweptAmount, buySignature: receipt.signature } :
            step === 'burn' ? { status: 'close', tokensBurned: receipt.burnedAmount, burnSignature: receipt.signature } :
            { status: 'completed', closeSignature: receipt.signature, rentRecovered: receipt.rentRefund, completedAt: new Date(now()).toISOString() };
          await db.BurnRewardCycle.update(cycle.id, { ...changes, lastError: '' });
          if (step === 'close') { patch.lastOutcome = 'Reward claim, purchase, burn and rent recovery completed.'; return { completed: true, cycleId: cycle.id }; }
          continue;
        }
        const attemptKey = `${cycle.id}:${step}`;
        if (attempted.has(attemptKey)) {
          await db.BurnRewardCycle.update(cycle.id, { lastError: receipts.find(row => row.status === 'failed')?.error || 'Retrying this stage on the next run.' });
          return { pending: true, reason: 'Stage attempt settled unsuccessfully; retrying on the next scheduled run.' };
        }
        attempted.add(attemptKey);
        // A failed buy has consumed no allocation. New finalized claims can add
        // to its budget before a fresh attempt; a pending buy is never rebuilt.
        if (step === 'buy') {
          ledger = rewardLedger(await allWalletRecords(db), state.rewardStartedAt);
          assertRewardBudget(ledger.available, ledger);
          cycle = await db.BurnRewardCycle.update(cycle.id, { budget: ledger.available, fundingSignatures: ledger.claimSignatures });
        }
        try {
          const prepared = await prepareCycleStep(ctx, cycle, ledger, step);
          if (prepared.skipped) {
            claimAssert(step === 'close', 'Only optional account cleanup may be skipped.');
            await db.BurnRewardCycle.update(cycle.id, { status: 'completed', cleanupNote: prepared.reason, completedAt: new Date(now()).toISOString() });
            patch.lastOutcome = 'Purchased tokens burned; account cleanup skipped.';
            return { completed: true, cycleId: cycle.id, reason: prepared.reason };
          }
          await saveAndSend(prepared);
        } catch (error) {
          await db.BurnRewardCycle.update(cycle.id, { lastError: error.message });
          throw error;
        }
      }
      return { pending: true, reason: 'Progress saved; the next scheduled run will resume this cycle.' };
    } catch (error) {
      patch.lastError = error.message; patch.lastOutcome = 'Reward cycle paused at its saved stage.'; throw error;
    } finally { await releaseBuybackLock(db, locked, patch); }
  };
}
