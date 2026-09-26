import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { rewardLedger, assertRewardBudget, cycleReceipt } from '../../base44/shared/rewardCycleCore.js';
import { createRewardCycleRunner } from '../../base44/shared/rewardCycleRunner.js';
import { authorizeRewardWorker } from '../../base44/shared/rewardCycleAuth.js';
import { CLAIM_MINT, CLAIM_WALLET } from '../../base44/shared/creatorClaimsCore.js';
import { exactBudget } from '../../base44/shared/burnBuybackTrade.ts';
import { purchasePlan, quoteTransfers, settleCycleStep } from '../../base44/shared/rewardCycleChain.ts';
import { buildBuybackTransaction } from '../../base44/shared/burnBuybackTransaction.ts';
import { messageHash } from '../../base44/shared/creatorClaims.ts';
import { prepareBuyback } from '../../base44/shared/burnBuybackPrepare.ts';
import { prepareManualBuyback } from '../../base44/shared/burnBuybackManual.ts';
const require = createRequire(import.meta.url);
const sdk = require('@pump-fun/pump-sdk'), w = require('@solana/web3.js'), spl = require('@solana/spl-token'), BN = require('bn.js');
const epoch = '2026-09-26T00:00:00.000Z', createdAt = '2026-09-26T01:00:00.000Z';
const claim = (signature = 'claim', value = '1000000000', extra = {}) => ({ id: signature, signature, wallet: CLAIM_WALLET, status: 'confirmed', createdAt,
  claimVersion: 1, claimScope: 'mint', attributedMint: CLAIM_MINT, quoteMint: spl.NATIVE_MINT.toBase58(), totalAccrued: value, networkFee: '5000', ...extra });
const stepRow = (step, extra = {}) => ({ id: step, signature: step, wallet: CLAIM_WALLET, buyMint: CLAIM_MINT, cycleVersion: 1, cycleId: 'cycle', epoch,
  cycleStep: step, status: 'confirmed', createdAt, totalAccrued: '0', sweptAmount: '0', burnedAmount: '0', rentRefund: '0', networkFee: '5000', ...extra });

test('only finalized mint-specific reward receipts fund the 80% ledger', () => {
  const rows = [claim(), claim('pending', '9000000000', { status: 'pending' }), claim('pooled', '9000000000', { claimScope: 'creator-wallet' }),
    claim('othercoin', '9000000000', { attributedMint: 'other' }), claim('otherwallet', '9000000000', { wallet: 'other' }),
    claim('tokenquote', '9000000000', { quoteMint: 'other' }), claim('old', '9000000000', { createdAt: '2026-01-01T00:00:00Z' }),
    { ...claim('deposit', '9000000000'), claimVersion: undefined, source: 'wallet deposit' }];
  const ledger = rewardLedger(rows, epoch);
  assert.equal(ledger.claimed, '1000000000'); assert.equal(ledger.allocated, '800000000'); assert.equal(ledger.retained, '200000000');
  assert.equal(ledger.available, '800000000'); assert.deepEqual(ledger.claimSignatures, ['claim']);
  assert.equal(assertRewardBudget('800000000', ledger), 800000000n);
  assert.throws(() => assertRewardBudget('800000001', ledger), /reward balance/);
});
test('wallet balance, rent and network fees cannot increase reward buying power', () => {
  for (const walletBalance of ['0', '1', '999999999999999999999']) {
    const ledger = rewardLedger([claim('claim', '100'), stepRow('buy', { sweptAmount: '79' }), stepRow('close', { rentRefund: '9999999999' })], epoch);
    assert.equal(ledger.available, '1'); assert.equal(ledger.protected, '21'); assert.equal(ledger.retained, '20');
    assert.throws(() => assertRewardBudget('2', { ...ledger, walletBalance }), /reward balance/);
  }
  assert.equal(rewardLedger([], epoch).available, '0');
  assert.equal(rewardLedger([claim()], undefined).available, '0');
});
test('allocation rounding, duplicate receipts and overspent ledgers fail safely', () => {
  const ledger = rewardLedger([claim('a', '1'), claim('b', '9')], epoch);
  assert.equal(ledger.allocated, '7'); assert.equal(ledger.retained, '3');
  assert.throws(() => rewardLedger([claim(), claim()], epoch), /Duplicate/);
  assert.throws(() => rewardLedger([claim('claim', '100'), stepRow('buy', { sweptAmount: '81' })], epoch), /exceed/);
  assert.throws(() => rewardLedger([claim('claim', '-1')], epoch), /Invalid exact/);
});

test('retired wallet-funded purchase builders reject all calls', async () => {
  await assert.rejects(() => prepareBuyback({ walletBalance: '9999999999' }), /wallet-funded/);
  await assert.rejects(() => prepareManualBuyback({ walletBalance: '9999999999' }), /wallet-funded/);
});

for (const route of ['curve', 'amm']) test(`real ${route} IDL enforces exact reward input and 1% minimum output`, () => {
  const program = route === 'curve' ? sdk.getPumpProgram(null) : sdk.getPumpAmmProgram(null);
  const originalName = route === 'curve' ? 'buyV2' : 'buy', exactName = route === 'curve' ? 'buyExactQuoteInV2' : 'buyExactQuoteIn';
  const original = program.idl.instructions.find(x => x.name === originalName);
  const tokenAddress = w.Keypair.generate().publicKey;
  const keys = original.accounts.map(a => ({ pubkey: a.name === 'user' ? new w.PublicKey(CLAIM_WALLET) :
    ['associatedBaseUser', 'userBaseTokenAccount'].includes(a.name) ? tokenAddress : w.Keypair.generate().publicKey, isSigner: a.name === 'user', isWritable: true }));
  const args = Object.fromEntries(original.args.map((a, i) => [a.name, a.type === 'u64' ? new BN(i === 0 ? 10000 : 800000000) : { 0: true }]));
  const ix = new w.TransactionInstruction({ programId: program.programId, keys, data: program.coder.instruction.encode(originalName, args) });
  exactBudget([ix], program, program.programId, originalName, exactName, new BN(800000000), route === 'curve' ? 'minTokensOut' : 'minBaseAmountOut');
  const decoded = program.coder.instruction.decode(ix.data);
  assert.equal(decoded.name, exactName); assert.equal(decoded.data.spendableQuoteIn.toString(), '800000000');
  const plan = purchasePlan([ix], '800000000', { address: tokenAddress });
  assert.equal(plan.minimumOut, '9900'); assert.equal(plan.tradeIndex, 2); assert.equal(plan.route, route);
  assert.throws(() => purchasePlan([ix], '900000000', { address: tokenAddress }), /reward budget/);
});

function receipt(step, amount = '100') {
  const keys = [CLAIM_WALLET, 'token'];
  const balance = n => [{ accountIndex: 1, mint: CLAIM_MINT, owner: CLAIM_WALLET, uiTokenAmount: { amount: n, decimals: 6 } }];
  return { keys, plan: { step, tokenAccount: 'token', decimals: 6, budget: '800', minimumOut: '99', burnAmount: amount },
    meta: { err: null, fee: 5000, preBalances: [10000000, 2039280], postBalances: [9995000, 2039280], preTokenBalances: balance('500'), postTokenBalances: balance(step === 'buy' ? '600' : '400') } };
}
test('receipts burn the acquired delta and preserve pre-existing token holdings', () => {
  const buy = receipt('buy'); const r = cycleReceipt(buy.meta, buy.keys, buy.plan, ['700', '100']);
  assert.equal(r.coinsReceived, '100'); assert.equal(r.sweptAmount, '800');
  const burn = receipt('burn'); assert.equal(cycleReceipt(burn.meta, burn.keys, burn.plan).burnedAmount, '100');
  burn.plan.burnAmount = '500'; assert.throws(() => cycleReceipt(burn.meta, burn.keys, burn.plan), /exactly/);
  assert.throws(() => cycleReceipt(buy.meta, buy.keys, buy.plan, ['801']), /reward budget/);
});
test('cleanup verifies zero tokens and sends rent only to the treasury', () => {
  const f = receipt('close'); f.meta.preTokenBalances[0].uiTokenAmount.amount = '0'; f.meta.postTokenBalances = [];
  f.meta.postBalances = [12034280, 0];
  assert.equal(cycleReceipt(f.meta, f.keys, f.plan).rentRefund, '2039280');
  f.meta.preTokenBalances[0].uiTokenAmount.amount = '1'; assert.throws(() => cycleReceipt(f.meta, f.keys, f.plan), /empty/);
});
test('trade spend evidence excludes rent and unrelated transfers', () => {
  const systemTransfer = (source, destination, lamports) => ({ programId: w.SystemProgram.programId, parsed: { type: 'transfer', info: { source, destination, lamports } } });
  const plan = { route: 'curve', tradeIndex: 2, quoteDestinations: ['curve', 'fee'], rentAccounts: ['volume'] };
  const parsed = { meta: { innerInstructions: [{ index: 2, instructions: [systemTransfer(CLAIM_WALLET, 'curve', 790), systemTransfer(CLAIM_WALLET, 'fee', 10), systemTransfer(CLAIM_WALLET, 'volume', 9000), systemTransfer('other', 'curve', 9999)] }] } };
  assert.deepEqual(quoteTransfers(parsed, plan), ['790', '10']);
  parsed.meta.innerInstructions[0].instructions.push(systemTransfer(CLAIM_WALLET, 'unexpected', 1));
  assert.throws(() => quoteTransfers(parsed, plan), /Unexpected SOL recipient/);
  assert.deepEqual(quoteTransfers({ meta: { innerInstructions: [{ index: 2, instructions: [{ programId: spl.TOKEN_PROGRAM_ID, parsed: { type: 'transferChecked', info: { source: 'wsol', tokenAmount: { amount: '800' } } } }] }] } }, { route: 'amm', tradeIndex: 2, quoteAccount: 'wsol' }), ['800']);
});

test('operating fees cannot be paid from the protected reward balance', async () => {
  const wallet = w.Keypair.generate(); let simulated = false;
  const ctx = { wallet, base44: { asServiceRole: { entities: { LaunchLookupTable: { filter: async () => [] } } } }, connection: {
    getLatestBlockhash: async () => ({ blockhash: w.Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    getFeeForMessage: async () => ({ value: 6000 }), getBalance: async () => 1030005999,
    simulateTransaction: async () => { simulated = true; return { value: { err: null, accounts: [{ lamports: 229000000 }] } }; },
  } };
  await assert.rejects(() => buildBuybackTransaction(ctx, [], false, { protectedLamports: '1000000000', rewardDebit: '800000000' }), /operating reserve/);
  assert.equal(simulated, false);
  ctx.connection.getBalance = async () => 2000000000;
  await assert.rejects(() => buildBuybackTransaction(ctx, [], false, { protectedLamports: '1000000000', rewardDebit: '800000000' }), /protected reward allocations/);
});

function runnerFixture() {
  let time = Date.parse(createdAt), counter = 0;
  const state = { id: 'state', wallet: CLAIM_WALLET, automationEnabled: true, rewardStartedAt: epoch, lockToken: 'ours', lockUntil: new Date(time + 600000).toISOString() };
  const records = [], cycles = [], events = [], flags = { skipClaim: false, burnFails: false, pending: false, skipClose: false, sendTimeout: false, crashAfterBuy: false };
  const matches = (row, query) => Object.entries(query).every(([key, value]) => value && typeof value === 'object' ? row[key] !== value.$ne : row[key] === value);
  const entity = (rows, type) => ({ filter: async (query, sort, limit = 100, offset = 0) => rows.filter(row => matches(row, query)).slice(offset, offset + limit).map(x => ({ ...x })),
    create: async row => { const saved = { ...row, id: `${type}-${++counter}` }; rows.push(saved); events.push(`save:${type}:${row.cycleStep || 'claim'}`); return { ...saved }; },
    update: async (id, patch) => {
      if (type === 'cycle' && patch.status === 'burn' && flags.crashAfterBuy) { flags.crashAfterBuy = false; throw new Error('Database interrupted after buy'); }
      const row = rows.find(row => row.id === id); Object.assign(row, patch); return { ...row };
    } });
  const db = { BuybackRecord: entity(records, 'receipt'), BurnRewardCycle: entity(cycles, 'cycle') };
  const ctx = { db, wallet: { publicKey: new w.PublicKey(CLAIM_WALLET) }, connection: {
    getBalance: async () => { throw new Error('Runner must not use wallet balance as budget'); },
    sendRawTransaction: async bytes => { events.push(`send:${Buffer.from(bytes)}`); if (flags.sendTimeout) throw new Error('timeout'); },
  } };
  const deps = { now: () => time, wait: async ms => { time += ms; }, timeLimit: 5000,
    getBuybackState: async () => ({ ...state }), acquireBuybackLock: async () => ({ ...state }), releaseBuybackLock: async (_, __, patch) => { Object.assign(state, patch); events.push('release'); },
    inspectClaim: async () => ({ claimScope: 'mint', attributedMint: CLAIM_MINT }),
    prepareCreatorClaim: async () => {
      events.push('prepare:claim'); if (flags.skipClaim) return { skipped: true };
      const signature = `claim-${++counter}`;
      return { ...claim(signature), status: 'pending', totalAccrued: '0', signedTransaction: Buffer.from(signature).toString('base64') };
    },
    prepareCycleStep: async (_, cycle, ledger, step) => {
      events.push(`prepare:${step}`); if (step === 'close' && flags.skipClose) return { skipped: true, reason: 'Existing holdings remain.' };
      if (step === 'buy') { assert.equal(cycle.budget, ledger.available); assertRewardBudget(cycle.budget, ledger); }
      const signature = `${step}-${++counter}`;
      return stepRow(step, { id: undefined, signature, cycleId: cycle.id, status: 'pending', signedTransaction: Buffer.from(signature).toString('base64'), budget: cycle.budget, burnAmount: cycle.tokensBought });
    },
    settleBuyback: async (_, row, rebroadcast) => {
      events.push(`settle:${row.cycleStep || 'claim'}:${rebroadcast}`);
      if (flags.pending) return row;
      const patch = row.claimVersion === 1 ? { totalAccrued: '1000000000' } : row.cycleStep === 'buy' ? { coinsReceived: '1000', sweptAmount: row.budget } : row.cycleStep === 'burn' ? { burnedAmount: row.burnAmount } : { rentRefund: '2039280' };
      return db.BuybackRecord.update(row.id, { status: flags.burnFails && row.cycleStep === 'burn' ? 'failed' : 'confirmed', ...patch, error: flags.burnFails ? 'Burn failed' : '' });
    } };
  return { ctx, deps, state, records, cycles, events, flags, run: () => createRewardCycleRunner(deps)(ctx) };
}

test('full worker claims, spends exactly 80% of receipts, burns and closes in order', async () => {
  const f = runnerFixture(); const result = await f.run();
  assert.equal(result.completed, true); assert.equal(f.cycles[0].budget, '800000000');
  assert.equal(f.cycles[0].tokensBought, '1000'); assert.equal(f.cycles[0].tokensBurned, '1000');
  assert.equal(f.cycles[0].status, 'completed');
  assert.deepEqual(f.events.filter(x => x.startsWith('prepare:')), ['prepare:claim', 'prepare:buy', 'prepare:burn', 'prepare:close']);
  for (const sent of f.events.filter(x => x.startsWith('send:'))) assert.ok(f.events.slice(0, f.events.indexOf(sent)).some(x => x.startsWith('save:receipt')));
  const ledger = rewardLedger(f.records, epoch); assert.equal(ledger.retained, '200000000'); assert.equal(ledger.available, '0');
});
test('a rich wallet with no verified rewards never prepares a purchase', async () => {
  const f = runnerFixture(); f.flags.skipClaim = true;
  assert.equal((await f.run()).skipped, true); assert.equal(f.cycles.length, 0); assert.equal(f.events.includes('prepare:buy'), false);
});
test('failed burns resume without another claim or purchase', async () => {
  const f = runnerFixture(); f.flags.burnFails = true; await f.run();
  assert.equal(f.cycles[0].status, 'burn'); f.flags.burnFails = false;
  await f.run(); assert.equal(f.cycles[0].status, 'completed');
  assert.equal(f.events.filter(x => x === 'prepare:buy').length, 1); assert.equal(f.events.filter(x => x === 'prepare:claim').length, 1);
  assert.equal(f.events.filter(x => x === 'prepare:burn').length, 2);
});
test('database interruption after a finalized purchase cannot cause a second purchase', async () => {
  const f = runnerFixture(); f.flags.crashAfterBuy = true;
  await assert.rejects(() => f.run(), /Database interrupted/);
  await f.run(); assert.equal(f.cycles[0].status, 'completed');
  assert.equal(f.events.filter(x => x === 'prepare:buy').length, 1); assert.equal(f.events.filter(x => x === 'prepare:claim').length, 1);
});
test('ambiguous submissions remain saved and pending across scheduled invocations', async () => {
  const f = runnerFixture(); f.flags.sendTimeout = true; f.flags.pending = true;
  await f.run(); await f.run();
  assert.equal(f.records.length, 1); assert.equal(f.events.filter(x => x === 'prepare:claim').length, 1); assert.equal(f.cycles.length, 0);
});
test('pause, lock contention and pooled rewards cannot start a cycle', async () => {
  const f = runnerFixture(); f.state.automationEnabled = false; await f.run(); assert.equal(f.records.length, 0);
  const g = runnerFixture(); g.deps.acquireBuybackLock = async () => null; await g.run(); assert.equal(g.events.length, 0);
  const h = runnerFixture(); h.deps.inspectClaim = async () => ({ claimScope: 'creator-wallet' }); await assert.rejects(() => h.run(), /isolated Burn/); assert.equal(h.records.length, 0);
});
test('pause or lease loss after persistence prevents submission of the saved transaction', async () => {
  for (const loseLease of [false, true]) {
    const f = runnerFixture(); const original = f.ctx.db.BuybackRecord.create;
    f.ctx.db.BuybackRecord.create = async row => {
      const saved = await original(row);
      if (loseLease) f.state.lockToken = 'another worker'; else f.state.automationEnabled = false;
      f.flags.pending = true;
      return saved;
    };
    if (loseLease) await assert.rejects(() => f.run(), /lease expired or changed/); else await f.run();
    assert.equal(f.records.length, 1); assert.equal(f.records[0].status, 'pending');
    assert.equal(f.events.some(x => x.startsWith('send:')), false);
  }
});
test('nonempty token accounts are left open after purchased tokens are burned', async () => {
  const f = runnerFixture(); f.flags.skipClose = true; await f.run();
  assert.equal(f.cycles[0].status, 'completed'); assert.equal(f.cycles[0].tokensBurned, '1000');
  assert.equal(f.records.some(row => row.cycleStep === 'close'), false); assert.match(f.cycles[0].cleanupNote, /Existing holdings/);
});
test('workflow authorization uses caller-scoped admin RLS, never injected service access', async () => {
  const privileged = { entities: { BurnBuybackState: { filter: async () => [{ id: 'state' }] } } };
  assert.equal(await authorizeRewardWorker({ entities: { BurnBuybackState: { filter: async () => [] } }, asServiceRole: privileged }), false);
  assert.equal(await authorizeRewardWorker(privileged), true);
  assert.equal(await authorizeRewardWorker({ entities: { BurnBuybackState: { filter: async () => { throw new Error('403'); } } } }), false);
  const schema = JSON.parse(fs.readFileSync(new URL('../../base44/entities/BurnBuybackState.jsonc', import.meta.url)));
  assert.equal(schema.rls.read.user_condition.role, 'admin');
});
test('scheduler checks every five minutes and activation defaults to disabled', () => {
  const workflow = JSON.parse(fs.readFileSync(new URL('../../base44/workflows/Burn%20Buyback%20Sweep.jsonc', import.meta.url)));
  assert.equal(workflow.trigger.config.cron_expression, '*/5 * * * *');
  assert.equal(workflow.definition.do[0].sweep_rewards.with.function_name, 'runBurnRewardCycle');
  const schema = JSON.parse(fs.readFileSync(new URL('../../base44/entities/BurnBuybackState.jsonc', import.meta.url)));
  assert.equal(schema.properties.automationEnabled.default, false);
});

async function settlementFixture() {
  const f = receipt('burn');
  const message = new w.TransactionMessage({ payerKey: new w.PublicKey(CLAIM_WALLET), recentBlockhash: w.Keypair.generate().publicKey.toBase58(), instructions: [] }).compileToV0Message();
  message.getAccountKeys = () => ({ length: f.keys.length, get: i => ({ toBase58: () => f.keys[i] }) });
  const row = stepRow('burn', { status: 'pending', stepPlan: f.plan, messageHash: await messageHash(message.serialize()), signedTransaction: Buffer.from('exact bytes').toString('base64'), lastValidBlockHeight: 100 });
  const updates = [], sends = [];
  const ctx = { db: { BuybackRecord: { update: async (_, patch) => { updates.push(patch); return { ...row, ...patch }; } } }, connection: {
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'finalized', err: null }] }), getBlockHeight: async () => 99,
    getTransaction: async () => ({ transaction: { signatures: [row.signature], message }, meta: f.meta }), sendRawTransaction: async bytes => sends.push(Buffer.from(bytes).toString()),
  } };
  return { ctx, row, updates, sends };
}
test('burn settlement verifies the saved message and actual finalized token destruction', async () => {
  const f = await settlementFixture(); const result = await settleCycleStep(f.ctx, f.row);
  assert.equal(result.status, 'confirmed'); assert.equal(result.burnedAmount, '100'); assert.equal(result.signedTransaction, '');
  f.row.messageHash = 'altered'; await assert.rejects(() => settleCycleStep(f.ctx, f.row), /saved transaction/);
});
test('pending burn rebroadcasts identical bytes; missing metadata and expiry races cannot duplicate it', async () => {
  const f = await settlementFixture(); f.ctx.connection.getTransaction = async () => null;
  assert.equal((await settleCycleStep(f.ctx, f.row)).status, 'pending');
  f.ctx.connection.getSignatureStatuses = async () => ({ value: [null] });
  await settleCycleStep(f.ctx, f.row, true); assert.deepEqual(f.sends, ['exact bytes']);
  f.ctx.connection.getBlockHeight = async () => 101; let reads = 0;
  f.ctx.connection.getSignatureStatuses = async () => ({ value: [++reads === 1 ? null : { confirmationStatus: 'confirmed' }] });
  assert.equal((await settleCycleStep(f.ctx, f.row)).status, 'pending'); assert.equal(f.updates.length, 0);
});
