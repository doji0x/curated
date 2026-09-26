import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createClaimTools, claimReceipt, assertClaimWallet, CLAIM_MINT, CLAIM_WALLET } from '../../base44/shared/creatorClaimsCore.js';
import { createClaimRunner } from '../../base44/shared/creatorClaimRun.js';
import { settleCreatorClaim, messageHash } from '../../base44/shared/creatorClaims.ts';
import { buybackTotals } from '../../base44/shared/burnBuybackConfig.ts';
import { buildBuybackTransaction } from '../../base44/shared/burnBuybackTransaction.ts';
const require = createRequire(import.meta.url);
const sdk = require('@pump-fun/pump-sdk'), amm = require('@pump-fun/pump-swap-sdk'), spl = require('@solana/spl-token'), web3 = require('@solana/web3.js'), BN = require('bn.js');
const { PublicKey, SystemProgram, Keypair, TransactionMessage } = web3;
const tools = createClaimTools({ sdk, amm, spl, web3 }), wallet = new PublicKey(CLAIM_WALLET), mint = new PublicKey(CLAIM_MINT);
const configKey = sdk.feeSharingConfigPda(mint), curveKey = sdk.bondingCurvePda(mint);
const fixture = JSON.parse(fs.readFileSync(new URL('./public-accounts.json', import.meta.url)));
const info = (data, owner, lamports = 1) => ({ data, owner, lamports, executable: false, rentEpoch: 0 });
function tokenInfo(address, owner, amount = 0n) {
  const data = Buffer.alloc(spl.ACCOUNT_SIZE);
  spl.AccountLayout.encode({ mint: spl.NATIVE_MINT, owner, amount, delegateOption: 0, delegate: PublicKey.default, state: 1,
    isNativeOption: 1, isNative: 2039280n, delegatedAmount: 0n, closeAuthorityOption: 0, closeAuthority: PublicKey.default }, data);
  return info(data, spl.TOKEN_PROGRAM_ID, Number(amount + 2039280n));
}
async function context({ direct = false, graduated = false, pumpAmount = 5000000, ammAmount = 0n, shareBps = 10000 } = {}) {
  const map = new Map(fixture.accounts.map(a => [a.address, { ...a, data: Buffer.from(a.data, 'base64'), owner: new PublicKey(a.owner) }]));
  const curve = sdk.PUMP_SDK.decodeBondingCurve(map.get(curveKey.toBase58()));
  const creator = direct ? wallet : configKey;
  curve.creator = creator; curve.complete = graduated;
  map.set(curveKey.toBase58(), info(await sdk.getPumpProgram(null).coder.accounts.encode('bondingCurve', curve), sdk.PUMP_PROGRAM_ID));
  const config = sdk.PUMP_SDK.decodeSharingConfig(map.get(configKey.toBase58()));
  if (shareBps !== 10000) {
    config.shareholders = [{ address: wallet, shareBps }, { address: Keypair.generate().publicKey, shareBps: 10000 - shareBps }];
    map.set(configKey.toBase58(), info(await sdk.getPumpFeeProgram(null).coder.accounts.encode('sharingConfig', config), sdk.PUMP_FEE_PROGRAM_ID));
  }
  const pv = sdk.creatorVaultPda(creator), authority = amm.coinCreatorVaultAuthorityPda(creator), av = amm.coinCreatorVaultAtaPda(authority, spl.NATIVE_MINT, spl.TOKEN_PROGRAM_ID);
  map.set(pv.toBase58(), info(Buffer.alloc(0), SystemProgram.programId, 890880 + pumpAmount));
  if (graduated) {
    const pool = { poolBump: 1, index: 0, creator: Keypair.generate().publicKey, baseMint: mint, quoteMint: spl.NATIVE_MINT,
      lpMint: Keypair.generate().publicKey, poolBaseTokenAccount: Keypair.generate().publicKey, poolQuoteTokenAccount: Keypair.generate().publicKey,
      lpSupply: new BN(0), coinCreator: creator, isMayhemMode: false, isCashbackCoin: false, virtualQuoteReserves: new BN(0), creatorFeeBps: new BN(0), canEditCreatorFee: false, isHolderReward: false };
    map.set(sdk.canonicalPumpPoolPdaWithQuote(mint, spl.NATIVE_MINT).toBase58(), info(await sdk.getPumpAmmProgram(null).coder.accounts.encode('pool', pool), sdk.PUMP_AMM_PROGRAM_ID));
    map.set(av.toBase58(), tokenInfo(av, authority, ammAmount));
  }
  const connection = { getMultipleAccountsInfo: async keys => keys.map(k => map.get(k.toBase58()) || null),
    getAccountInfo: async k => map.get(k.toBase58()) || null, getMinimumBalanceForRentExemption: async () => 890880 };
  const online = new sdk.OnlinePumpSdk(connection);
  // Only the read-only RPC view is stubbed. Real SDK builders and account decoders run.
  online.getMinimumDistributableFee = async () => ({ canDistribute: true });
  return { connection, online, map, pv, av };
}
function names(instructions) {
  return instructions.filter(ix => ix.programId.equals(sdk.PUMP_PROGRAM_ID) || ix.programId.equals(sdk.PUMP_AMM_PROGRAM_ID)).map(ix =>
    (ix.programId.equals(sdk.PUMP_PROGRAM_ID) ? sdk.getPumpProgram(null) : sdk.getPumpAmmProgram(null)).coder.instruction.decode(ix.data).name);
}
for (const direct of [false, true]) for (const graduated of [false, true]) {
  test(`real SDK claim: ${direct ? 'direct' : 'sharing'}, ${graduated ? 'PumpSwap' : 'curve'}`, async () => {
    const ctx = await context({ direct, graduated, ammAmount: graduated ? 9000000n : 0n });
    const result = await tools.prepareInstructions(ctx.connection, ctx.online, wallet);
    assert.equal(result.claim.route, direct ? 'direct' : 'sharing');
    assert.equal(result.claim.claimScope, direct ? 'creator-wallet' : 'mint');
    assert.equal(result.claim.attributedMint, direct ? '' : CLAIM_MINT);
    assert.deepEqual(names(result.instructions), direct ? ['collectCreatorFeeV2', ...(graduated ? ['collectCoinCreatorFee'] : [])] : [...(graduated ? ['transferCreatorFeesToPump'] : []), 'distributeCreatorFees']);
    assert.equal(result.claim.estimatedClaim, graduated ? '14000000' : '5000000');
    const tx = new web3.VersionedTransaction(new TransactionMessage({ payerKey: wallet, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: result.instructions }).compileToV0Message());
    assert.ok(tx.serialize().length <= 1232);
    assert.equal(tx.message.staticAccountKeys[0].toBase58(), CLAIM_WALLET);
    assert.equal(tx.message.header.numRequiredSignatures, 1);
  });
}
test('AMM-only direct claim omits the empty Pump vault', async () => {
  const c = await context({ direct: true, graduated: true, pumpAmount: 0, ammAmount: 9000n });
  const result = await tools.prepareInstructions(c.connection, c.online, wallet);
  assert.deepEqual(names(result.instructions), ['collectCoinCreatorFee']);
});
test('empty vaults skip; wallet deposits cannot create rewards', async () => {
  const c = await context({ pumpAmount: 0 }); c.connection.getBalance = async () => 9000000000;
  const result = await tools.prepareInstructions(c.connection, c.online, wallet);
  assert.equal(result.skipped, true); assert.equal(result.instructions, undefined);
});
test('small claims are allowed and the protocol distribution minimum is respected', async () => {
  const c = await context({ pumpAmount: 5000000 });
  assert.ok((await tools.prepareInstructions(c.connection, c.online, wallet)).instructions);
  c.online.getMinimumDistributableFee = async () => ({ canDistribute: false });
  assert.equal((await tools.prepareInstructions(c.connection, c.online, wallet)).skipped, true);
});
test('wrong wallet, vault owner, recipient and quote are rejected', async () => {
  assert.throws(() => assertClaimWallet(Keypair.generate().publicKey), /designated treasury/);
  const c = await context(); c.map.get(c.pv.toBase58()).owner = sdk.PUMP_PROGRAM_ID;
  await assert.rejects(() => tools.inspect(c.connection, wallet), /vault owner/);
  const d = await context();
  const curve = sdk.PUMP_SDK.decodeBondingCurve(d.map.get(curveKey.toBase58())); curve.creator = Keypair.generate().publicKey;
  d.map.get(curveKey.toBase58()).data = await sdk.getPumpProgram(null).coder.accounts.encode('bondingCurve', curve);
  await assert.rejects(() => tools.inspect(d.connection, wallet), /do not belong/);
  curve.quoteMint = Keypair.generate().publicKey;
  d.map.get(curveKey.toBase58()).data = await sdk.getPumpProgram(null).coder.accounts.encode('bondingCurve', curve);
  await assert.rejects(() => tools.inspect(d.connection, wallet), /SOL rewards only/);
});
test('migration and mismatched sharing recipients fail closed', async () => {
  const c = await context({ graduated: true }); c.map.delete(sdk.canonicalPumpPoolPdaWithQuote(mint, spl.NATIVE_MINT).toBase58());
  await assert.rejects(() => tools.inspect(c.connection, wallet), /Migration/);
  const d = await context(); const config = sdk.PUMP_SDK.decodeSharingConfig(d.map.get(configKey.toBase58()));
  config.shareholders = [{ address: Keypair.generate().publicKey, shareBps: 10000 }];
  d.map.get(configKey.toBase58()).data = await sdk.getPumpFeeProgram(null).coder.accounts.encode('sharingConfig', config);
  await assert.rejects(() => tools.inspect(d.connection, wallet), /not a recipient/);
});
function receiptFixture(extra = {}) {
  const plan = { wallet: CLAIM_WALLET, pumpVault: 'pump', ammVault: 'amm', recipientAta: 'ata', quoteMint: spl.NATIVE_MINT.toBase58(), route: 'sharing', shareBps: 10000, pumpAmount: '10000', ammAmount: '0', ...extra };
  const keys = [CLAIM_WALLET, 'pump', 'amm', 'ata'];
  const meta = { err: null, fee: 5000, preBalances: [1000000, 900880, 0, 0], postBalances: [1005000, 890880, 0, 0], preTokenBalances: [], postTokenBalances: [] };
  return { plan, keys, meta };
}
test('claim receipt uses actual finalized inflow, not estimated or existing balance', () => {
  const f = receiptFixture(); f.plan.estimatedClaim = '999999999';
  const r = claimReceipt(f.meta, f.keys, f.plan);
  assert.equal(r.totalAccrued, '10000'); assert.equal(r.sweptAmount, '0'); assert.equal(r.coinsReceived, '0');
  f.meta.preBalances[0] += 9000000; f.meta.postBalances[0] += 9000000;
  assert.equal(claimReceipt(f.meta, f.keys, f.plan).totalAccrued, '10000');
});
test('direct receipt excludes pre-existing WSOL and refunded account rent', () => {
  const f = receiptFixture({ route: 'direct', ammAmount: '20000' });
  f.meta.preBalances[3] = 2039280 + 100;
  f.meta.postBalances[0] += 20000 + 2039280 + 100;
  f.meta.preTokenBalances = [{ accountIndex: 2, mint: f.plan.quoteMint, uiTokenAmount: { amount: '20000' } }, { accountIndex: 3, mint: f.plan.quoteMint, uiTokenAmount: { amount: '100' } }];
  const r = claimReceipt(f.meta, f.keys, f.plan);
  assert.equal(r.totalAccrued, '30000'); assert.equal(r.rentRefund, '2039280'); assert.equal(r.unwrappedExisting, '100');
});
test('sharing receipt credits only this shareholder and handles concurrent AMM accrual', () => {
  const f = receiptFixture({ shareBps: 5000 });
  f.meta.preTokenBalances = [{ accountIndex: 2, mint: f.plan.quoteMint, uiTokenAmount: { amount: '10000' } }];
  assert.equal(claimReceipt(f.meta, f.keys, f.plan).totalAccrued, '10000');
  assert.equal(claimReceipt(f.meta, f.keys, f.plan).totalDistributed, '20000');
});
test('missing or inconsistent receipt evidence cannot credit rewards', () => {
  const f = receiptFixture(); f.meta.postBalances[0] += 1;
  assert.throws(() => claimReceipt(f.meta, f.keys, f.plan), /reconcile/);
  f.meta.err = { failed: true }; assert.throws(() => claimReceipt(f.meta, f.keys, f.plan), /failed transaction/);
  const g = receiptFixture(); assert.throws(() => claimReceipt(g.meta, [], g.plan), /balances/);
});
async function settlementFixture() {
  const f = receiptFixture();
  const message = new TransactionMessage({ payerKey: wallet, recentBlockhash: Keypair.generate().publicKey.toBase58(), instructions: [] }).compileToV0Message();
  // Use a real serialized message, with its account list supplied independently for metadata fixtures.
  message.getAccountKeys = () => ({ length: f.keys.length, get: i => ({ toBase58: () => f.keys[i] }) });
  const row = { id: 'saved', signature: 'signature', wallet: CLAIM_WALLET, claimPlan: f.plan, messageHash: await messageHash(message.serialize()), status: 'pending', lastValidBlockHeight: 100, signedTransaction: Buffer.from('exact saved bytes').toString('base64') };
  const updates = [], sends = [];
  const ctx = { db: { BuybackRecord: { update: async (id, patch) => { updates.push(patch); return { ...row, ...patch }; } } }, connection: {
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'finalized', err: null }] }),
    getTransaction: async () => ({ transaction: { signatures: [row.signature], message }, meta: f.meta }),
    getBlockHeight: async () => 101, sendRawTransaction: async bytes => sends.push(Buffer.from(bytes).toString()),
  } };
  return { row, ctx, updates, sends };
}
test('finalized claim updates the same saved record; missing RPC metadata stays pending', async () => {
  const f = await settlementFixture(); assert.equal((await settleCreatorClaim(f.ctx, f.row)).totalAccrued, '10000');
  assert.equal(f.updates.length, 1); assert.equal(f.updates[0].signedTransaction, '');
  f.ctx.connection.getTransaction = async () => null;
  assert.equal((await settleCreatorClaim(f.ctx, f.row)).status, 'pending'); assert.equal(f.updates.length, 1);
});
test('reverted and expired transactions do not credit a claim', async () => {
  const f = await settlementFixture(); f.ctx.connection.getSignatureStatuses = async () => ({ value: [{ confirmationStatus: 'finalized', err: { failed: true } }] });
  assert.equal((await settleCreatorClaim(f.ctx, f.row)).status, 'failed');
  assert.equal(f.updates[0].totalAccrued, undefined);
  f.ctx.connection.getSignatureStatuses = async () => ({ value: [null] });
  assert.equal((await settleCreatorClaim(f.ctx, f.row)).status, 'failed'); assert.equal(f.sends.length, 0);
});
test('ambiguous submission rebroadcasts only the saved transaction', async () => {
  const f = await settlementFixture(); f.ctx.connection.getSignatureStatuses = async () => ({ value: [null] }); f.ctx.connection.getBlockHeight = async () => 99;
  assert.equal((await settleCreatorClaim(f.ctx, f.row, true)).status, 'pending');
  assert.deepEqual(f.sends, ['exact saved bytes']); assert.equal(f.updates.length, 0);
});
test('expiry race retains a transaction seen on the second lookup', async () => {
  const f = await settlementFixture(); let calls = 0;
  f.ctx.connection.getSignatureStatuses = async () => ({ value: [++calls === 1 ? null : { confirmationStatus: 'confirmed', err: null }] });
  assert.equal((await settleCreatorClaim(f.ctx, f.row)).status, 'pending'); assert.equal(f.updates.length, 0);
});
test('changed claim message cannot be credited', async () => {
  const f = await settlementFixture(); f.row.messageHash = 'wrong';
  await assert.rejects(() => settleCreatorClaim(f.ctx, f.row), /differs/); assert.equal(f.updates.length, 0);
});
function runnerFixture() {
  const events = [], state = { id: 'state', enabled: true, wallet: CLAIM_WALLET, lockToken: 'ours', lockUntil: new Date(Date.now() + 60000).toISOString() };
  const deps = { getBuybackState: async () => state, acquireBuybackLock: async () => state, releaseBuybackLock: async () => events.push('release'),
    settleBuyback: async (_, row) => row, prepareCreatorClaim: async () => { events.push('prepare'); return { signature: 'sig', status: 'pending', signedTransaction: Buffer.from('claim').toString('base64') }; } };
  const ctx = { wallet: { publicKey: wallet }, connection: { sendRawTransaction: async () => { events.push('send'); throw new Error('timeout'); } }, db: {
    BurnBuybackState: { update: async () => {} }, BuybackRecord: { filter: async () => [], create: async row => { events.push('persist'); return { id: 'row', ...row }; } } } };
  return { deps, ctx, events };
}
test('claim persists before sending and survives timeout without exposing signed bytes', async () => {
  const f = runnerFixture(); const result = await createClaimRunner(f.deps)(f.ctx, 'claim');
  assert.deepEqual(f.events, ['prepare', 'persist', 'send', 'release']); assert.equal(result.record.status, 'pending'); assert.equal(result.record.signedTransaction, undefined);
});
test('lock contention and pending transactions prevent duplicate claims', async () => {
  const f = runnerFixture(); f.deps.acquireBuybackLock = async () => null;
  assert.equal((await createClaimRunner(f.deps)(f.ctx, 'claim')).skipped, true); assert.deepEqual(f.events, []);
  const g = runnerFixture(); g.ctx.db.BuybackRecord.filter = async () => [{ status: 'pending', signature: 'old', claimVersion: 1 }];
  assert.equal((await createClaimRunner(g.deps)(g.ctx, 'claim')).pending, true); assert.deepEqual(g.events, ['release']);
});
test('old automatic and manual purchase routes cannot spend the wallet', async () => {
  const f = runnerFixture();
  for (const action of ['run', 'buy']) assert.equal((await createClaimRunner(f.deps)(f.ctx, action)).skipped, true);
  assert.deepEqual(f.events, []);
});
test('recovery only settles the requested saved claim and never prepares another', async () => {
  for (const status of ['pending', 'confirmed', 'failed']) {
    const f = runnerFixture();
    f.ctx.db.BuybackRecord.filter = async query => {
      assert.deepEqual(query, { wallet: CLAIM_WALLET, signature: 'saved' });
      return [{ signature: 'saved', status, claimVersion: 1, signedTransaction: 'private bytes' }];
    };
    f.deps.settleBuyback = async (_, row, rebroadcast) => { assert.equal(rebroadcast, true); f.events.push('settle'); return { ...row, status: 'confirmed' }; };
    const result = await createClaimRunner(f.deps)(f.ctx, 'recover', 'saved');
    assert.equal(result.record.signature, 'saved'); assert.equal(result.record.signedTransaction, undefined);
    assert.deepEqual(f.events, status === 'pending' ? ['settle', 'release'] : ['release']);
  }
});
test('recovery refuses missing signatures, unknown records, historical buys and lost leases', async () => {
  const f = runnerFixture();
  await assert.rejects(() => createClaimRunner(f.deps)(f.ctx, 'recover'), /Choose a saved/);
  await assert.rejects(() => createClaimRunner(f.deps)(f.ctx, 'recover', 'unknown'), /no saved creator claim/);
  f.ctx.db.BuybackRecord.filter = async () => [{ signature: 'purchase', status: 'pending' }];
  await assert.rejects(() => createClaimRunner(f.deps)(f.ctx, 'recover', 'purchase'), /no saved creator claim/);
  f.ctx.db.BuybackRecord.filter = async () => [{ signature: 'saved', claimVersion: 1, status: 'pending' }];
  const original = f.deps.getBuybackState; let reads = 0;
  f.deps.getBuybackState = async () => ({ ...await original(), lockToken: ++reads === 1 ? 'ours' : 'different' });
  await assert.rejects(() => createClaimRunner(f.deps)(f.ctx, 'recover', 'saved'), /authorization changed/);
  assert.equal(f.events.some(event => ['prepare', 'send', 'persist'].includes(event)), false);
});
test('a saved signature is reused without creating or sending another claim', async () => {
  const f = runnerFixture();
  f.ctx.db.BuybackRecord.filter = async query => query.signature ? [{ id: 'existing', signature: 'sig', signedTransaction: 'private bytes' }] : [];
  const result = await createClaimRunner(f.deps)(f.ctx, 'claim');
  assert.equal(result.record.id, 'existing'); assert.equal(result.record.signedTransaction, undefined);
  assert.deepEqual(f.events, ['prepare', 'release']);
});
test('losing the lease during persistence leaves the saved transaction unsent', async () => {
  const f = runnerFixture(); let reads = 0;
  const original = f.deps.getBuybackState;
  f.deps.getBuybackState = async () => ({ ...await original(), lockToken: ++reads >= 3 ? 'another worker' : 'ours' });
  await assert.rejects(() => createClaimRunner(f.deps)(f.ctx, 'claim'), /saved but not sent/);
  assert.deepEqual(f.events, ['prepare', 'persist', 'release']);
});
test('claim builder requires the actual network fee, but no buyback reserve', async () => {
  const signer = Keypair.generate(); let simulations = 0;
  const ctx = { wallet: signer, base44: { asServiceRole: { entities: { LaunchLookupTable: { filter: async () => [] } } } }, connection: {
    getLatestBlockhash: async () => ({ blockhash: Keypair.generate().publicKey.toBase58(), lastValidBlockHeight: 100 }),
    getFeeForMessage: async () => ({ value: 6000 }), getBalance: async () => 5999,
    simulateTransaction: async (_, options) => { assert.equal(options.sigVerify, true); simulations++; return { value: { err: null } }; },
  } };
  await assert.rejects(() => buildBuybackTransaction(ctx, []), /transaction fee/); assert.equal(simulations, 0);
  ctx.connection.getBalance = async () => 6000;
  const result = await buildBuybackTransaction(ctx, []);
  assert.ok(result.fields.signature); assert.equal(simulations, 1);
});
test('new claims stay separate from historical spendable allocations', async () => {
  const rows = [{ claimVersion: 1, claimScope: 'mint', totalAccrued: '100', networkFee: '2' }, { claimVersion: 1, claimScope: 'creator-wallet', totalAccrued: '20', networkFee: '1' }];
  const totals = await buybackTotals({ BuybackRecord: { filter: async () => rows } }, CLAIM_WALLET);
  assert.equal(totals.claimed, '120'); assert.equal(totals.mintClaimed, '100'); assert.equal(totals.pooledClaimed, '20');
  assert.equal(totals.carry, '0'); assert.equal(totals.retained, '0'); assert.equal(totals.claimFees, '3');
});
