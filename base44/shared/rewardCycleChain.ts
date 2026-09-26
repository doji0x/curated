import { Buffer } from 'node:buffer';
import { PublicKey, VersionedTransaction, SystemProgram } from 'npm:@solana/web3.js@1.98.4';
import { TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync, unpackMint, unpackAccount, createBurnCheckedInstruction, createCloseAccountInstruction } from 'npm:@solana/spl-token@0.4.15';
import { PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, getPumpProgram, getPumpAmmProgram } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { CLAIM_MINT, CLAIM_WALLET, claimAssert } from './creatorClaimsCore.js';
import { claimTools, messageHash } from './creatorClaims.ts';
import { burnTrade } from './burnBuybackTrade.ts';
import { buildBuybackTransaction } from './burnBuybackTransaction.ts';
import { assertRewardBudget, cycleReceipt } from './rewardCycleCore.js';

export async function tokenState(ctx) {
  const mint = new PublicKey(CLAIM_MINT);
  const info = await ctx.connection.getAccountInfo(mint, 'confirmed');
  claimAssert(info && [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some(p => p.equals(info.owner)), 'Unsupported Burn mint owner.');
  const mintState = unpackMint(mint, info, info.owner);
  claimAssert(mintState.isInitialized, 'Burn mint is not initialized.');
  const address = getAssociatedTokenAddressSync(mint, ctx.wallet.publicKey, false, info.owner);
  const accountInfo = await ctx.connection.getAccountInfo(address, 'confirmed');
  const account = accountInfo ? unpackAccount(address, accountInfo, info.owner) : null;
  claimAssert(!account || (account.mint.equals(mint) && account.owner.equals(ctx.wallet.publicKey) && !account.isFrozen), 'Invalid or frozen treasury Burn token account.');
  return { mint, program: info.owner, decimals: mintState.decimals, address, account };
}

// Named account mapping comes from the same published IDL used to encode the buy.
export function purchasePlan(instructions, budget, token) {
  const trades = instructions.map((ix, index) => ({ ix, index })).filter(({ ix }) => ix.programId.equals(PUMP_PROGRAM_ID) || ix.programId.equals(PUMP_AMM_PROGRAM_ID));
  const buys = trades.flatMap(({ ix, index }) => {
    const program = ix.programId.equals(PUMP_PROGRAM_ID) ? getPumpProgram(null) : getPumpAmmProgram(null);
    const decoded = program.coder.instruction.decode(ix.data);
    if (!['buyExactQuoteInV2', 'buyExactQuoteIn'].includes(decoded?.name)) return [];
    const accounts = Object.fromEntries(program.idl.instructions.find(row => row.name === decoded.name).accounts.map((a, i) => [a.name, ix.keys[i].pubkey.toBase58()]));
    claimAssert(decoded.data.spendableQuoteIn.toString() === budget, 'SDK purchase does not match the reward budget.');
    claimAssert((accounts.associatedBaseUser || accounts.userBaseTokenAccount) === token.address.toBase58() && accounts.user === CLAIM_WALLET, 'Unexpected purchase recipient.');
    return [{ tradeIndex: index + 2, route: ix.programId.equals(PUMP_PROGRAM_ID) ? 'curve' : 'amm',
      tradeProgram: ix.programId.toBase58(), minimumOut: (decoded.data.minTokensOut || decoded.data.minBaseAmountOut).toString(),
      quoteAccount: accounts.userQuoteTokenAccount || '',
      quoteDestinations: [accounts.bondingCurve, accounts.feeRecipient, accounts.buybackFeeRecipient, accounts.creatorVault].filter(Boolean),
      rentAccounts: [accounts.userVolumeAccumulator, accounts.associatedUserVolumeAccumulator].filter(Boolean) }];
  });
  claimAssert(buys.length === 1, 'Expected exactly one reward-funded purchase instruction.');
  return buys[0];
}

export async function prepareCycleStep(ctx, cycle, ledger, step) {
  const token = await tokenState(ctx);
  let instructions, details = {};
  if (step === 'buy') {
    assertRewardBudget(cycle.budget, ledger);
    await claimTools.inspect(ctx.connection, ctx.wallet.publicKey);
    instructions = await burnTrade(ctx, BigInt(cycle.budget));
    details = purchasePlan(instructions, cycle.budget, token);
  } else if (step === 'burn') {
    claimAssert(token.account && token.account.amount >= BigInt(cycle.tokensBought) && BigInt(cycle.tokensBought) > 0n, 'Purchased tokens are missing; reconcile before burning.');
    instructions = [createBurnCheckedInstruction(token.address, token.mint, ctx.wallet.publicKey, BigInt(cycle.tokensBought), token.decimals, [], token.program)];
  } else {
    claimAssert(step === 'close', 'Invalid cycle step.');
    if (!token.account) return { skipped: true, reason: 'Token account is already closed.' };
    if (token.account.amount !== 0n) return { skipped: true, reason: 'Existing token holdings remain; account left open.' };
    if (token.account.closeAuthority && !token.account.closeAuthority.equals(ctx.wallet.publicKey)) return { skipped: true, reason: 'Account has another close authority; account left open.' };
    instructions = [createCloseAccountInstruction(token.address, ctx.wallet.publicKey, ctx.wallet.publicKey, [], token.program)];
  }
  const built = await buildBuybackTransaction(ctx, instructions, false, { protectedLamports: ledger.protected, rewardDebit: step === 'buy' ? cycle.budget : '0' });
  const tx = VersionedTransaction.deserialize(Buffer.from(built.fields.signedTransaction, 'base64'));
  return { ...built.fields, source: `reward cycle ${step}`, wallet: CLAIM_WALLET, buyMint: CLAIM_MINT, cycleVersion: 1, cycleId: cycle.id,
    epoch: cycle.epoch, cycleStep: step, status: 'pending', createdAt: new Date().toISOString(), totalAccrued: '0', sweptAmount: '0', coinsReceived: '0', sweptBps: 8000,
    messageHash: await messageHash(tx.message.serialize()), stepPlan: { ...details, step, tokenAccount: token.address.toBase58(), tokenProgram: token.program.toBase58(),
      decimals: token.decimals, budget: cycle.budget, burnAmount: cycle.tokensBought || '0' } };
}

export function quoteTransfers(parsed, plan) {
  const group = parsed.meta?.innerInstructions?.find(row => row.index === plan.tradeIndex);
  claimAssert(group, 'RPC omitted purchase transfer evidence.');
  const transfers = [];
  for (const ix of group.instructions) {
    const p = ix.parsed;
    if (!p || !['transfer', 'transferChecked'].includes(p.type)) continue;
    if (plan.route === 'curve' && ix.programId.toBase58() === SystemProgram.programId.toBase58() && p.info.source === CLAIM_WALLET) {
      if (plan.rentAccounts.includes(p.info.destination)) continue;
      claimAssert(plan.quoteDestinations.includes(p.info.destination), 'Unexpected SOL recipient inside purchase.');
      claimAssert(Number.isSafeInteger(p.info.lamports), 'Inexact SOL transfer receipt.');
      transfers.push(String(p.info.lamports));
    }
    if (plan.route === 'amm' && ix.programId.equals(TOKEN_PROGRAM_ID) && p.info.source === plan.quoteAccount) {
      transfers.push(p.info.tokenAmount?.amount || p.info.amount);
    }
  }
  return transfers;
}

export async function settleCycleStep(ctx, row, rebroadcast = false) {
  const { connection, db } = ctx;
  const status = (await connection.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0];
  if (status?.confirmationStatus === 'finalized') {
    if (status.err) return db.BuybackRecord.update(row.id, { status: 'failed', error: JSON.stringify(status.err), signedTransaction: '' });
    const tx = await connection.getTransaction(row.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
    if (!tx?.meta) return row;
    claimAssert(!tx.meta.err && tx.transaction.signatures[0] === row.signature && await messageHash(tx.transaction.message.serialize()) === row.messageHash, 'Cycle receipt does not match its saved transaction.');
    const accountKeys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const keys = Array.from({ length: accountKeys.length }, (_, i) => accountKeys.get(i).toBase58());
    claimAssert(keys[0] === CLAIM_WALLET && row.wallet === CLAIM_WALLET, 'Unexpected cycle fee payer.');
    let transfers = [];
    if (row.cycleStep === 'buy') {
      const parsed = await connection.getParsedTransaction(row.signature, { commitment: 'finalized', maxSupportedTransactionVersion: 0 });
      if (!parsed?.meta) return row;
      claimAssert(parsed.transaction.signatures[0] === row.signature && !parsed.meta.err, 'Purchase transfer evidence differs from saved receipt.');
      transfers = quoteTransfers(parsed, row.stepPlan);
    }
    const receipt = cycleReceipt(tx.meta, keys, row.stepPlan, transfers);
    return db.BuybackRecord.update(row.id, { ...receipt, status: 'confirmed', confirmedAt: new Date().toISOString(), signedTransaction: '', error: '' });
  }
  if (status) return row;
  if (await connection.getBlockHeight('finalized') > row.lastValidBlockHeight) {
    const again = (await connection.getSignatureStatuses([row.signature], { searchTransactionHistory: true })).value[0];
    if (again) return row;
    return db.BuybackRecord.update(row.id, { status: 'failed', error: 'Transaction expired without landing.', signedTransaction: '' });
  }
  if (rebroadcast && row.signedTransaction) {
    try { await connection.sendRawTransaction(Buffer.from(row.signedTransaction, 'base64'), { skipPreflight: false, maxRetries: 2 }); }
    catch { /* Preserve the same signature after ambiguous sends. */ }
  }
  return row;
}
