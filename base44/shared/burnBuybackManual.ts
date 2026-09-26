import { burnMint, gasReserve, minimumBuy, spendableBalance } from './burnBuybackConfig.ts';
import { buildBuybackTransaction } from './burnBuybackTransaction.ts';
import { burnTrade } from './burnBuybackTrade.ts';

export function validateManualAmount(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Enter a positive whole-number lamport amount.');
  const amount = BigInt(value);
  if (amount < minimumBuy) throw new Error('The minimum manual buy is 0.01 SOL.');
  return amount;
}
export async function prepareManualBuyback(ctx, action, value) {
  const balance = BigInt(await ctx.connection.getBalance(ctx.wallet.publicKey, 'confirmed'));
  const available = spendableBalance(balance);
  const amount = action === 'claim' ? available : validateManualAmount(value);
  if (action === 'claim' && amount < minimumBuy) return { skipped: true, reason: 'No SOL rewards are currently available above the reserve and transaction costs.' };
  if (action === 'buy' && amount > balance - gasReserve) throw new Error('This amount exceeds the wallet balance minus the 0.03 SOL operating reserve.');
  const instructions = await burnTrade(ctx, amount);
  const transaction = await buildBuybackTransaction(ctx, instructions, true);
  return { source: action === 'claim' ? 'manual claim buyback' : 'manual buy', wallet: ctx.wallet.publicKey.toBase58(), buyMint: burnMint, totalAccrued: '0', sweptBps: 8000, sweptAmount: String(amount), status: 'pending', createdAt: new Date().toISOString(), ...transaction.fields };
}