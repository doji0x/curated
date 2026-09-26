import { Buffer } from 'node:buffer';
import { PURCHASES_PAUSED } from './creatorClaimsCore.js';

export function createClaimRunner({ getBuybackState, settleBuyback, acquireBuybackLock, releaseBuybackLock, prepareCreatorClaim }) {
  return async function runBuyback(ctx, action = 'run', signature = '') {
    const { db, wallet, connection } = ctx;
    // The old balance sweep could spend claimed rewards and retained treasury SOL.
    // Hold every purchase entry point until the per-coin allocation worker exists.
    if (!['claim', 'recover'].includes(action)) return { skipped: true, reason: PURCHASES_PAUSED };
    if (action === 'recover' && !signature) throw new Error('Choose a saved claim to recover.');
    const state = await getBuybackState(db);
    const locked = await acquireBuybackLock(db);
    if (!locked) return { skipped: true, reason: 'Another worker holds the buyback lock. Please try again shortly.' };
    const token = locked.lockToken;
    const patch = { lastError: '', lastOutcome: '' };
    try {
      if (locked.wallet && locked.wallet !== wallet.publicKey.toBase58()) throw new Error('The configured signing wallet changed. Reconcile existing buybacks before switching wallets.');
      await db.BurnBuybackState.update(state.id, { wallet: wallet.publicKey.toBase58() });
      if (action === 'recover') {
        const [saved] = await db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58(), signature }, 'created_date', 1);
        if (!saved || saved.claimVersion !== 1) throw new Error('This wallet has no saved creator claim with that signature.');
        const current = await getBuybackState(db);
        if (current.lockToken !== token || Date.parse(current.lockUntil) <= Date.now()) throw new Error('Worker authorization changed; refresh before recovering.');
        const result = saved.status === 'pending' ? await settleBuyback(ctx, saved, true) : saved;
        const { signedTransaction, ...record } = result;
        patch.lastOutcome = `Saved claim checked: ${record.status}.`;
        return { record }; // Never fall through to preparing a new transaction.
      }
      const pending = await db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58(), status: 'pending' }, 'created_date', 10);
      for (const row of pending) {
        const result = await settleBuyback(ctx, row, row.claimVersion === 1);
        if (result.status === 'pending') { patch.lastOutcome = 'A saved transaction is awaiting finalization; no new claim was created.'; return { pending: true, signature: row.signature }; }
      }
      // Older deployments may have more pending rows than this batch.
      const [remaining] = await db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58(), status: 'pending' }, 'created_date', 1);
      if (remaining) return { pending: true, signature: remaining.signature };
      const prepared = await prepareCreatorClaim(ctx);
      if (prepared.skipped) { patch.lastOutcome = prepared.reason; return prepared; }
      const current = await getBuybackState(db);
      if (current.lockToken !== token || Date.parse(current.lockUntil) <= Date.now()) throw new Error('Worker authorization changed before submission; nothing was sent.');
      // Persist the exact signature BEFORE sending. A network timeout can only
      // lead to rebroadcasting this same transaction, never to a duplicate claim.
      const [existing] = await db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58(), signature: prepared.signature }, 'created_date', 1);
      if (existing) {
        const { signedTransaction, ...publicRecord } = existing;
        return { record: publicRecord, message: 'This exact claim already has a receipt. Refresh to check its status.' };
      }
      const record = await db.BuybackRecord.create(prepared);
      const beforeSend = await getBuybackState(db);
      if (beforeSend.lockToken !== token || Date.parse(beforeSend.lockUntil) <= Date.now()) throw new Error('Claim saved but not sent because the worker lease changed. Check the saved signature before retrying.');
      let sendError;
      try { await connection.sendRawTransaction(Buffer.from(prepared.signedTransaction, 'base64'), { skipPreflight: false, maxRetries: 2 }); }
      catch (error) { sendError = error; }
      const { signedTransaction, ...publicRecord } = record;
      const message = sendError ? 'Submission is unconfirmed. The saved signature will be checked before another transaction is allowed.' : 'Claim submitted; waiting for finalization.';
      patch.lastOutcome = `${prepared.source}: ${message}`;
      return { record: publicRecord, message };
    } catch (error) {
      patch.lastOutcome = 'Claim halted; see the error and any pending transaction.';
      patch.lastError = error.message;
      throw error;
    } finally {
      await releaseBuybackLock(db, locked, patch);
    }
  };
}
