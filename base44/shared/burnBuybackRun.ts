import { Buffer } from 'node:buffer';
import { getBuybackState, buybackTotals } from './burnBuybackConfig.ts';
import { settleBuyback } from './burnBuybackSettlement.ts';
import { prepareBuyback } from './burnBuybackPrepare.ts';

export async function runBuyback(ctx) {
  const { db, wallet, connection } = ctx;
  const state = await getBuybackState(db);
  if (!state.enabled) return { skipped: true, reason: 'Buybacks are paused.' };
  const now = new Date().toISOString(), token = crypto.randomUUID();
  await db.BurnBuybackState.updateMany({ id: state.id, lockUntil: { $lte: now } }, { $set: { lockToken: token, lockUntil: new Date(Date.now() + 600000).toISOString() } });
  const locked = await getBuybackState(db);
  if (locked.lockToken !== token) return { skipped: true, reason: 'Another worker holds the buyback lock.' };
  const patch = { lastRunAt: now, lastError: '', lastOutcome: '' };
  try {
    if (locked.wallet && locked.wallet !== wallet.publicKey.toBase58()) throw new Error('The configured signing wallet changed. Reconcile existing buybacks before switching wallets.');
    await db.BurnBuybackState.update(state.id, { wallet: wallet.publicKey.toBase58() });
    const pending = await db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58(), status: 'pending' }, 'created_date', 10);
    for (const row of pending) {
      const result = await settleBuyback(ctx, row);
      if (result.status === 'pending') { patch.lastOutcome = 'A saved transaction is awaiting finalization; no new purchase was created.'; return { pending: true, signature: row.signature }; }
    }
    const totals = await buybackTotals(db, wallet.publicKey.toBase58());
    const prepared = await prepareBuyback(ctx, totals);
    if (prepared.skipped) { patch.lastOutcome = prepared.reason; return prepared; }
    const current = await getBuybackState(db);
    if (!current.enabled || current.lockToken !== token || Date.parse(current.lockUntil) <= Date.now()) throw new Error('Worker authorization changed before submission; nothing was sent.');
    // Persist the exact signature BEFORE sending. A network timeout can only
    // lead to rebroadcasting this same transaction, never to a second buy.
    const record = await db.BuybackRecord.create(prepared);
    await connection.sendRawTransaction(Buffer.from(prepared.signedTransaction, 'base64'), { skipPreflight: false, maxRetries: 2 });
    const result = await settleBuyback(ctx, record, false);
    patch.lastOutcome = result.status === 'confirmed' ? 'Buyback finalized and recorded.' : 'Buyback submitted; finalization will be reconciled before the next purchase.';
    return { status: result.status, signature: result.signature };
  } catch (error) {
    patch.lastOutcome = 'Buyback halted; see the error and any pending transaction.';
    patch.lastError = error.message;
    throw error;
  } finally {
    await db.BurnBuybackState.updateMany({ id: state.id, lockToken: token }, { $set: { ...patch, lockToken: '', lockUntil: '1970-01-01T00:00:00.000Z' } });
  }
}