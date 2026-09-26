import { Buffer } from 'node:buffer';
import bs58 from 'npm:bs58@6.0.0';
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction, PublicKey } from 'npm:@solana/web3.js@1.98.4';
import { creatorVaultPda, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { coinCreatorVaultAtaPda, coinCreatorVaultAuthorityPda } from 'npm:@pump-fun/pump-swap-sdk@1.13.0';
import { readLaunchLookupTable, publicLaunchTableLabel } from './launchLookupTable.ts';
import { burnMint, solMint, gasReserve, allocation, minimumBuy } from './burnBuybackConfig.ts';
import { burnTrade } from './burnBuybackTrade.ts';

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
  const collectPump = Boolean(sol && !sol.pumpVault.isZero()), collectAmm = Boolean(sol && !sol.ammVault.isZero());
  const pumpVault = creatorVaultPda(wallet.publicKey);
  const pumpInfo = collectPump ? await connection.getAccountInfo(pumpVault, 'confirmed') : null;
  const pumpRent = pumpInfo ? await connection.getMinimumBalanceForRentExemption(pumpInfo.data.length) : 0;
  const ammVault = coinCreatorVaultAtaPda(coinCreatorVaultAuthorityPda(wallet.publicKey), new PublicKey(solMint), new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'));
  let claims = unclaimed > 0n ? await online.collectCoinCreatorFeeInstructions(wallet.publicKey) : [];
  // Don't ask a program to collect a nonexistent empty vault.
  claims = collectAmm ? claims.filter(ix => !ix.programId.equals(PUMP_PROGRAM_ID) || collectPump) : claims.filter(ix => ix.programId.equals(PUMP_PROGRAM_ID) && collectPump);
  const buys = await burnTrade(ctx, budget);
  const latest = await connection.getLatestBlockhash('confirmed');
  const table = await readLaunchLookupTable(base44, ctx.rpcUrl, publicLaunchTableLabel);
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1000000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), ...claims, ...buys];
  const message = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: latest.blockhash, instructions }).compileToV0Message(table ? [table] : []);
  const tx = new VersionedTransaction(message);
  tx.sign([wallet]);
  const raw = tx.serialize();
  if (raw.length > 1232) throw new Error('Atomic reward collection and buy exceed the transaction limit; no rewards were collected.');
  const simulation = await connection.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: true });
  if (simulation.value.err) throw new Error(`Buyback simulation failed; no funds moved: ${JSON.stringify(simulation.value.err)}`);
  if (preview) return { ready: true, simulated: true, submitted: false, unclaimed: String(unclaimed), budget: String(budget), bytes: raw.length };
  return { source: 'creator rewards', wallet: wallet.publicKey.toBase58(), buyMint: burnMint, totalAccrued: '0', sweptBps: 8000, sweptAmount: String(budget), status: 'pending', createdAt: new Date().toISOString(), signature: bs58.encode(tx.signatures[0]), signedTransaction: Buffer.from(raw).toString('base64'), lastValidBlockHeight: latest.lastValidBlockHeight, pumpVault: pumpVault.toBase58(), pumpRent: String(pumpRent), ammVault: ammVault.toBase58(), collectPump, collectAmm };
}