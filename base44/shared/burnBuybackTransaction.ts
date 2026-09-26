import { Buffer } from 'node:buffer';
import bs58 from 'npm:bs58@6.0.0';
import { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } from 'npm:@solana/web3.js@1.98.4';
import { readLaunchLookupTable, publicLaunchTableLabel } from './launchLookupTable.ts';
import { gasReserve } from './burnBuybackConfig.ts';

export async function buildBuybackTransaction(ctx, actions, protectReserve = false) {
  const { connection, wallet, base44 } = ctx;
  const latest = await connection.getLatestBlockhash('confirmed');
  const table = await readLaunchLookupTable(base44, ctx.rpcUrl, publicLaunchTableLabel);
  const instructions = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1000000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), ...actions];
  const message = new TransactionMessage({ payerKey: wallet.publicKey, recentBlockhash: latest.blockhash, instructions }).compileToV0Message(table ? [table] : []);
  const tx = new VersionedTransaction(message);
  // A claim may increase the wallet balance, but its fee payer must already be
  // able to pay the network fee. Do not impose the buyback operating reserve.
  const requiredFee = (await connection.getFeeForMessage(message, 'confirmed')).value;
  const payerBalance = await connection.getBalance(wallet.publicKey, 'confirmed');
  if (requiredFee === null || payerBalance < requiredFee) throw new Error('The treasury wallet needs SOL for the transaction fee before claiming. No transaction was sent.');
  tx.sign([wallet]);
  const raw = tx.serialize();
  if (raw.length > 1232) throw new Error('Transaction exceeds the size limit; no funds were moved.');
  const simulation = await connection.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: true, ...(protectReserve ? { accounts: { encoding: 'base64', addresses: [wallet.publicKey.toBase58()] } } : {}) });
  if (simulation.value.err) throw new Error(`Transaction simulation failed; no funds moved: ${JSON.stringify(simulation.value.err)}`);
  if (protectReserve) {
    const remaining = simulation.value.accounts?.[0]?.lamports;
    const fee = (await connection.getFeeForMessage(message, 'confirmed')).value;
    if (!Number.isSafeInteger(remaining) || fee === null || BigInt(remaining) - BigInt(fee) < gasReserve) throw new Error('Reduce the buy amount to leave the operating reserve plus transaction fees and account rent.');
  }
  return { bytes: raw.length, fields: { signature: bs58.encode(tx.signatures[0]), signedTransaction: Buffer.from(raw).toString('base64'), lastValidBlockHeight: latest.lastValidBlockHeight } };
}
