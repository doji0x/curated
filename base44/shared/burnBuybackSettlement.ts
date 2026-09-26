import { Buffer } from 'node:buffer';
import { burnMint } from './burnBuybackConfig.ts';
import { settleCreatorClaim } from './creatorClaims.ts';
import { settleCycleStep } from './rewardCycleChain.ts';

export async function settleBuyback(ctx, row, rebroadcast = true) {
  if (row.cycleVersion === 1) return settleCycleStep(ctx, row, rebroadcast);
  if (row.claimVersion === 1) return settleCreatorClaim(ctx, row, rebroadcast);
  const { connection, db } = ctx;
  const status = (await connection.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0];
  if (status?.confirmationStatus === 'finalized') {
    if (status.err) return db.BuybackRecord.update(row.id, { status: 'failed', error: JSON.stringify(status.err), signedTransaction: '' });
    const tx = await connection.getParsedTransaction(row.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return row;
    if (tx.meta.err) return db.BuybackRecord.update(row.id, { status: 'failed', error: JSON.stringify(tx.meta.err), signedTransaction: '' });
    const keys = tx.transaction.message.accountKeys.map(item => item.pubkey.toBase58());
    const sourceIndex = keys.indexOf(row.pumpVault), walletIndex = keys.indexOf(row.wallet);
    if (walletIndex < 0 || (row.collectPump && sourceIndex < 0)) throw new Error('Finalized receipt is missing expected accounts; manual reconciliation required.');
    const claimOnly = row.source === 'manual claim' && BigInt(row.sweptAmount || '0') === 0n;
    const pump = row.collectPump ? BigInt(tx.meta.preBalances[sourceIndex]) - BigInt(claimOnly ? tx.meta.postBalances[sourceIndex] : row.pumpRent) : 0n;
    const ammIndex = keys.indexOf(row.ammVault);
    const preAmm = tx.meta.preTokenBalances?.find(item => item.accountIndex === ammIndex);
    const postAmm = tx.meta.postTokenBalances?.find(item => item.accountIndex === ammIndex);
    if (row.collectAmm && !preAmm) throw new Error('Finalized receipt is missing the SOL reward vault; reconciliation required.');
    const amm = row.collectAmm ? BigInt(preAmm.uiTokenAmount.amount) - (claimOnly ? BigInt(postAmm?.uiTokenAmount.amount || '0') : 0n) : 0n;
    const amounts = list => (list || []).filter(item => item.mint === burnMint && item.owner === row.wallet).reduce((sum, item) => sum + BigInt(item.uiTokenAmount.amount), 0n);
    const coins = amounts(tx.meta.postTokenBalances) - amounts(tx.meta.preTokenBalances);
    const token = tx.meta.postTokenBalances?.find(item => item.mint === burnMint && item.owner === row.wallet);
    if (pump < 0n || amm < 0n || (claimOnly ? pump + amm <= 0n : coins <= 0n || !token)) throw new Error('Finalized receipt needs manual reconciliation; further actions are blocked.');
    return db.BuybackRecord.update(row.id, { status: 'confirmed', totalAccrued: row.source === 'manual claim buyback' || row.source === 'wallet reward buyback' ? '0' : String(pump + amm), coinsReceived: claimOnly ? '0' : String(coins), tokenDecimals: token?.uiTokenAmount.decimals || 0, remainingBalance: String(tx.meta.postBalances[walletIndex]), networkFee: String(tx.meta.fee), confirmedAt: new Date().toISOString(), signedTransaction: '', error: '' });
  }
  if (status) return row;
  const height = await connection.getBlockHeight('finalized');
  if (height > row.lastValidBlockHeight) return db.BuybackRecord.update(row.id, { status: 'failed', error: 'Transaction expired without landing. Rewards were not consumed.', signedTransaction: '' });
  if (rebroadcast && row.signedTransaction) {
    try { await connection.sendRawTransaction(Buffer.from(row.signedTransaction, 'base64'), { skipPreflight: false, maxRetries: 2 }); }
    catch { /* An ambiguous send is not a failed buy: retain this signature until finalized or expired. */ }
  }
  return row;
}
