import { getBuybackState } from './burnBuybackConfig.ts';
import { settleBuyback } from './burnBuybackSettlement.ts';

export async function acquireBuybackLock(db) {
  const state = await getBuybackState(db), token = crypto.randomUUID();
  await db.BurnBuybackState.updateMany({ id: state.id, lockUntil: { $lte: new Date().toISOString() } }, { $set: { lockToken: token, lockUntil: new Date(Date.now() + 600000).toISOString() } });
  const locked = await getBuybackState(db);
  return locked.lockToken === token ? locked : null;
}
export async function releaseBuybackLock(db, locked, patch = {}) {
  await db.BurnBuybackState.updateMany({ id: locked.id, lockToken: locked.lockToken }, { $set: { ...patch, lockToken: '', lockUntil: '1970-01-01T00:00:00.000Z' } });
}
export async function reconcileBuybackStatus(ctx) {
  const pending = await ctx.db.BuybackRecord.filter({ wallet: ctx.wallet.publicKey.toBase58(), status: 'pending' }, 'created_date', 10);
  if (!pending.length) return;
  const locked = await acquireBuybackLock(ctx.db);
  if (!locked) return;
  try {
    for (const row of pending) await settleBuyback(ctx, row, false);
  } finally { await releaseBuybackLock(ctx.db, locked); }
}