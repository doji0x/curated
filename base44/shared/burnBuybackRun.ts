import { Buffer } from 'node:buffer';
import { getBuybackState, buybackTotals } from './burnBuybackConfig.ts';
import { settleBuyback } from './burnBuybackSettlement.ts';
import { prepareBuyback } from './burnBuybackPrepare.ts';
import { acquireBuybackLock, releaseBuybackLock } from './burnBuybackLock.ts';
import { prepareManualBuyback } from './burnBuybackManual.ts';

export async function runBuyback(ctx, action = 'run', amount = undefined) {
  const { db, wallet, connection } = ctx;
  const manual = action === 'claim' || action === 'buy';
  const state = await getBuybackState(db);
  if (!manual && !state.enabled) return { skipped: true, reason: 'Buybacks are paused.' };
  const locked = await acquireBuybackLock(db);
  if (!locked) return { skipped: true, reason: 'Another worker holds the buyback lock. Please try again shortly.' };
  const token = locked.lockToken;
  const patch = { ...(!manual ? { lastRunAt: new Date().toISOString() } : {}), lastError: '', lastOutcome: '' };
  try {
    if (locked.wallet && locked.wallet !== wallet.publicKey.toBase58()) throw new Error('The configured signing wallet changed. Reconcile existing buybacks before switching wallets.');
    await db.BurnBuybackState.update(state.id, { wallet: wallet.publicKey.toBase58() });
    const pending = await db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58(), status: 'pending' }, 'created_date', 10);
    for (const row of pending) {
      const result = await settleBuyback(ctx, row);
      if (result.status === 'pending') { patch.lastOutcome = 'A saved transaction is awaiting finalization; no new purchase was created.'; return { pending: true, signature: row.signature }; }
    }
    const prepared = manual ? await prepareManualBuyback(ctx, action, amount) : await prepareBuyback(ctx, await buybackTotals(db, wallet.publicKey.toBase58()));
    if (prepared.skipped) { patch.lastOutcome = prepared.reason; return prepared; }
    const current = await getBuybackState(db);
    if ((!manual && !current.enabled) || current.lockToken !== token || Date.parse(current.lockUntil) <= Date.now()) throw new Error('Worker authorization changed before submission; nothing was sent.');
    // Persist the exact signature BEFORE sending. A network timeout can only
    // lead to rebroadcasting this same transaction, never to a second buy.
    const record = await db.BuybackRecord.create(prepared);
    let sendError;
    try { await connection.sendRawTransaction(Buffer.from(prepared.signedTransaction, 'base64'), { skipPreflight: false, maxRetries: 2 }); }
    catch (error) { if (!manual) throw error; sendError = error; }
    if (manual) {
      const { signedTransaction, ...publicRecord } = record;
      const message = sendError ? 'Submission is unconfirmed. The saved signature will be checked before another transaction is allowed.' : 'Transaction submitted; waiting for finalization.';
      patch.lastOutcome = `${prepared.source}: ${message}`;
      return { record: publicRecord, message };
    }
    const result = await settleBuyback(ctx, record, false);
    patch.lastOutcome = result.status === 'confirmed' ? 'Buyback finalized and recorded.' : 'Buyback submitted; finalization will be reconciled before the next purchase.';
    return { status: result.status, signature: result.signature };
  } catch (error) {
    patch.lastOutcome = 'Buyback halted; see the error and any pending transaction.';
    patch.lastError = error.message;
    throw error;
  } finally {
    await releaseBuybackLock(db, locked, patch);
  }
}