import { Buffer } from 'node:buffer';
import * as sdk from 'npm:@pump-fun/pump-sdk@2.0.0';
import * as amm from 'npm:@pump-fun/pump-swap-sdk@1.13.0';
import * as spl from 'npm:@solana/spl-token@0.4.15';
import * as web3 from 'npm:@solana/web3.js@1.98.4';
import { createClaimTools, CLAIM_SOURCE, claimAssert, claimReceipt } from './creatorClaimsCore.js';
import { buildBuybackTransaction } from './burnBuybackTransaction.ts';

export const claimTools = createClaimTools({ sdk, amm, spl, web3 });
export async function messageHash(message) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', message)).toString('hex');
}
export async function prepareCreatorClaim(ctx) {
  const prepared = await claimTools.prepareInstructions(ctx.connection, ctx.online, ctx.wallet.publicKey);
  if (prepared.skipped) return prepared;
  const transaction = await buildBuybackTransaction(ctx, prepared.instructions, false);
  const signed = web3.VersionedTransaction.deserialize(Buffer.from(transaction.fields.signedTransaction, 'base64'));
  return { source: CLAIM_SOURCE, wallet: ctx.wallet.publicKey.toBase58(), buyMint: prepared.claim.coinMint,
    totalAccrued: '0', sweptAmount: '0', coinsReceived: '0', sweptBps: 0, status: 'pending',
    claimVersion: 1, claimPlan: prepared.claim, claimScope: prepared.claim.claimScope, attributedMint: prepared.claim.attributedMint,
    quoteMint: prepared.claim.quoteMint, messageHash: await messageHash(signed.message.serialize()),
    createdAt: new Date().toISOString(), ...transaction.fields };
}

export async function settleCreatorClaim(ctx, row, rebroadcast = false) {
  const { connection, db } = ctx;
  const status = (await connection.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0];
  if (status?.confirmationStatus === 'finalized') {
    if (status.err) return db.BuybackRecord.update(row.id, { status: 'failed', error: JSON.stringify(status.err), signedTransaction: '' });
    const tx = await connection.getTransaction(row.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return row; // RPC lag is not proof of failure.
    claimAssert(!tx.meta.err && tx.transaction.signatures[0] === row.signature &&
      await messageHash(tx.transaction.message.serialize()) === row.messageHash, 'Finalized claim differs from the saved transaction. Manual reconciliation required.');
    const accountKeys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const keys = Array.from({ length: accountKeys.length }, (_, i) => accountKeys.get(i).toBase58());
    claimAssert(keys[0] === row.wallet && row.claimPlan?.wallet === row.wallet, 'Unexpected claim fee payer or recipient.');
    const receipt = claimReceipt(tx.meta, keys, row.claimPlan);
    return db.BuybackRecord.update(row.id, { ...receipt, status: 'confirmed', confirmedAt: new Date().toISOString(), signedTransaction: '', error: '' });
  }
  if (status) return row;
  if (await connection.getBlockHeight('finalized') > row.lastValidBlockHeight) {
    // Recheck after the height read: a transaction can finalize between RPC calls.
    const again = (await connection.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0];
    if (again) return row;
    return db.BuybackRecord.update(row.id, { status: 'failed', error: 'Claim expired without landing. No rewards were recorded.', signedTransaction: '' });
  }
  if (rebroadcast && row.signedTransaction) {
    try { await connection.sendRawTransaction(Buffer.from(row.signedTransaction, 'base64'), { skipPreflight: false, maxRetries: 2 }); }
    catch { /* Keep the same pending signature after an ambiguous send. */ }
  }
  return row;
}
