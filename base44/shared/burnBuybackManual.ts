import { burnMint, solMint, gasReserve, minimumBuy } from './burnBuybackConfig.ts';
import { solClaimInstructions } from './burnBuybackClaims.ts';
import { buildBuybackTransaction } from './burnBuybackTransaction.ts';
import { burnTrade } from './burnBuybackTrade.ts';

export function validateManualAmount(value) {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value) || !Number.isSafeInteger(Number(value))) throw new Error('Enter a positive whole-number lamport amount.');
  const amount = BigInt(value);
  if (amount < minimumBuy) throw new Error('The minimum manual buy is 0.01 SOL.');
  return amount;
}
export async function prepareManualBuyback(ctx, action, value) {
  let instructions, fields = {}, accrued = '0', amount = 0n;
  if (action === 'claim') {
    const rewards = await ctx.online.getCreatorVaultQuoteBalances(ctx.wallet.publicKey);
    const sol = rewards.find(row => row.mint.toBase58() === solMint);
    accrued = sol?.total.toString() || '0';
    if (BigInt(accrued) === 0n) return { skipped: true, reason: 'No SOL creator rewards are available to claim.' };
    const claim = await solClaimInstructions(ctx, sol);
    instructions = claim.instructions; fields = claim.fields;
  } else {
    amount = validateManualAmount(value);
    const balance = BigInt(await ctx.connection.getBalance(ctx.wallet.publicKey, 'confirmed'));
    if (amount > balance - gasReserve) throw new Error('This amount exceeds the wallet balance minus the 0.03 SOL operating reserve.');
    instructions = await burnTrade(ctx, amount);
  }
  const transaction = await buildBuybackTransaction(ctx, instructions, action === 'buy');
  return { source: action === 'claim' ? 'manual claim' : 'manual buy', wallet: ctx.wallet.publicKey.toBase58(), buyMint: burnMint, totalAccrued: accrued, sweptBps: 8000, sweptAmount: String(amount), status: 'pending', createdAt: new Date().toISOString(), ...fields, ...transaction.fields };
}