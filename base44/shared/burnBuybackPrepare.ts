import { burnMint, solMint, gasReserve, allocation, minimumBuy } from './burnBuybackConfig.ts';
import { burnTrade } from './burnBuybackTrade.ts';
import { solClaimInstructions } from './burnBuybackClaims.ts';
import { buildBuybackTransaction } from './burnBuybackTransaction.ts';

export async function prepareBuyback(ctx, totals, preview = false) {
  const { online, connection, wallet, base44 } = ctx;
  const rewards = await online.getCreatorVaultQuoteBalances(wallet.publicKey);
  const sol = rewards.find(row => row.mint.toBase58() === solMint);
  const unclaimed = BigInt(sol?.total.toString() || '0');
  const budget = allocation(unclaimed) + BigInt(totals.carry);
  if (budget < minimumBuy) {
    if (preview) await burnTrade(ctx, minimumBuy);
    return { skipped: true, reason: 'Below 0.01 SOL buyback minimum; rewards remain available for the next batch.', unclaimed: String(unclaimed), budget: String(budget), purchaseRouteValidated: preview, submitted: false };
  }
  const balance = BigInt(await connection.getBalance(wallet.publicKey, 'confirmed'));
  // Keep fees/rent outside the reward allocation. Existing deposits are never
  // counted as revenue, even though this shared wallet pays operating fees.
  if (balance < gasReserve + BigInt(totals.carry)) return { skipped: true, reason: 'Operating reserve or previously allocated SOL is unavailable. Buyback deferred.', budget: String(budget) };
  const claim = await solClaimInstructions(ctx, sol);
  const buys = await burnTrade(ctx, budget);
  const transaction = await buildBuybackTransaction(ctx, [...claim.instructions, ...buys]);
  if (preview) return { ready: true, simulated: true, submitted: false, unclaimed: String(unclaimed), budget: String(budget), bytes: transaction.bytes };
  return { source: 'creator rewards', wallet: wallet.publicKey.toBase58(), buyMint: burnMint, totalAccrued: '0', sweptBps: 8000, sweptAmount: String(budget), status: 'pending', createdAt: new Date().toISOString(), ...transaction.fields, ...claim.fields };
}