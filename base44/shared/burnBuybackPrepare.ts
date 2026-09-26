import { burnMint, gasReserve, allocation, minimumBuy, spendableBalance } from './burnBuybackConfig.ts';
import { burnTrade } from './burnBuybackTrade.ts';
import { buildBuybackTransaction } from './burnBuybackTransaction.ts';

export async function prepareBuyback(ctx, totals, preview = false) {
  const { connection, wallet } = ctx;
  const balance = BigInt(await connection.getBalance(wallet.publicKey, 'confirmed'));
  const available = balance > gasReserve ? balance - gasReserve : 0n;
  const budget = [allocation(available), spendableBalance(balance)].reduce((a, b) => a < b ? a : b);
  if (budget < minimumBuy) {
    if (preview) await burnTrade(ctx, minimumBuy);
    return { skipped: true, reason: 'Below the 0.01 SOL buyback minimum above the operating reserve and transaction costs.', unclaimed: String(available), budget: String(budget), purchaseRouteValidated: preview, submitted: false };
  }
  const buys = await burnTrade(ctx, budget);
  const transaction = await buildBuybackTransaction(ctx, buys, true);
  if (preview) return { ready: true, simulated: true, submitted: false, unclaimed: String(available), budget: String(budget), bytes: transaction.bytes };
  return { source: 'wallet reward buyback', wallet: wallet.publicKey.toBase58(), buyMint: burnMint, totalAccrued: '0', sweptBps: 8000, sweptAmount: String(budget), status: 'pending', createdAt: new Date().toISOString(), ...transaction.fields };
}