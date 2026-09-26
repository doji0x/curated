import { PublicKey } from 'npm:@solana/web3.js@1.98.4';
import { creatorVaultPda, PUMP_PROGRAM_ID } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { coinCreatorVaultAtaPda, coinCreatorVaultAuthorityPda } from 'npm:@pump-fun/pump-swap-sdk@1.13.0';
import { solMint, burnMint } from './burnBuybackConfig.ts';
import { buildBuybackTransaction } from './burnBuybackTransaction.ts';

export async function quoteSolRewards(ctx) {
  const balances = await ctx.online.getCreatorVaultQuoteBalances(ctx.wallet.publicKey);
  const rewards = balances.filter(row => !row.total.isZero() || row.mint.toBase58() === solMint).map(row => ({ mint: row.mint.toBase58(), pumpVault: row.pumpVault.toString(), ammVault: row.ammVault.toString(), total: row.total.toString() }));
  return { sol: balances.find(row => row.mint.toBase58() === solMint), rewards };
}

export async function prepareSolClaim(ctx) {
  const { sol } = await quoteSolRewards(ctx);
  if (!sol || sol.total.isZero()) return { skipped: true, reason: 'No SOL rewards are available in this wallet’s creator vaults.' };
  const { instructions, fields } = await solClaimInstructions(ctx, sol);
  if (!instructions.length) throw new Error('No SOL collection instructions were generated; no funds were moved.');
  const transaction = await buildBuybackTransaction(ctx, instructions);
  return { source: 'manual claim', wallet: ctx.wallet.publicKey.toBase58(), buyMint: burnMint, totalAccrued: '0', sweptBps: 0, sweptAmount: '0', status: 'pending', createdAt: new Date().toISOString(), ...fields, ...transaction.fields };
}

export async function solClaimInstructions(ctx, sol) {
  const { online, wallet, connection } = ctx;
  const collectPump = Boolean(sol && !sol.pumpVault.isZero());
  const collectAmm = Boolean(sol && !sol.ammVault.isZero());
  const pumpVault = creatorVaultPda(wallet.publicKey);
  const info = collectPump ? await connection.getAccountInfo(pumpVault, 'confirmed') : null;
  if (collectPump && !info) throw new Error('SOL reward vault changed; refresh and try again.');
  const pumpRent = info ? await connection.getMinimumBalanceForRentExemption(info.data.length) : 0;
  const ammVault = coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(wallet.publicKey), new PublicKey('So11111111111111111111111111111111111111112'), new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
  // This SDK method is SOL-only; its all-quotes counterpart is deliberately not used.
  let instructions = collectPump || collectAmm ? await online.collectCoinCreatorFeeInstructions(wallet.publicKey) : [];
  instructions = collectAmm ? instructions.filter(ix => !ix.programId.equals(PUMP_PROGRAM_ID) || collectPump) : instructions.filter(ix => ix.programId.equals(PUMP_PROGRAM_ID) && collectPump);
  return { instructions, fields: { collectPump, collectAmm, pumpVault: pumpVault.toBase58(), pumpRent: String(pumpRent), ammVault: ammVault.toBase58() } };
}