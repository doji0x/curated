import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createTreasuryTools } from '../../base44/shared/treasuryLaunchCore.js';
import { treasuryPolicy, TREASURY_ADDRESS, assertTreasuryIntent, assertLockedTreasuryConfig } from '../../base44/shared/treasuryPolicy.js';
const require = createRequire(import.meta.url);
const sdk = require('@pump-fun/pump-sdk'), web3 = require('@solana/web3.js'), spl = require('@solana/spl-token'), BN = require('bn.js');
const tools = createTreasuryTools({ sdk, web3, spl, BN });
const { Keypair, PublicKey, AddressLookupTableAccount, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = web3;
const key = () => Keypair.generate().publicKey;
async function fixture(quoteMint = spl.NATIVE_MINT, quoteTokenProgram = spl.TOKEN_PROGRAM_ID, extra = {}) {
  const mint = Keypair.generate(), payer = Keypair.generate();
  const args = { global: { feeRecipient: key(), feeRecipients: [], creatorFeeConfigurable: true, maxConfigurableCreatorFeeBps: new BN(500) },
    mint: mint.publicKey, user: payer.publicKey, name: 'Treasury test', symbol: 'TST', uri: 'https://example.com/m.json',
    amount: new BN(1000), quoteAmount: new BN(1000000), quoteMint, quoteTokenProgram, ...extra };
  const instructions = await tools.build(args);
  const input = { ...treasuryPolicy(), coinMint: mint.publicKey.toBase58(), walletAddress: payer.publicKey.toBase58(),
    name: args.name, symbol: args.symbol, metadataUrl: args.uri, quoteMint: quoteMint.toBase58(), quoteTokenProgram: quoteTokenProgram.toBase58(),
    quoteAmountAtomic: args.quoteAmount.toString(), minimumTokens: args.amount.toString(), creatorFeeBps: Number(args.creatorFeeBps?.toString() || 0) };
  return { args, instructions, input, mint, payer };
}
function table(addresses) {
  return new AddressLookupTableAccount({ key: key(), state: { deactivationSlot: (1n << 64n) - 1n,
    lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: undefined, addresses } });
}
function stable(sets) {
  const invoked = new Set(sets.flat().map(ix => ix.programId.toBase58()));
  const signed = new Set(sets.flatMap(a => a.flatMap(ix => ix.keys.filter(k => k.isSigner).map(k => k.pubkey.toBase58()))));
  const all = sets.map(a => new Set(a.flatMap(ix => ix.keys.map(k => k.pubkey.toBase58()))));
  return [...all[0]].filter(k => !invoked.has(k) && !signed.has(k) && all.every(s => s.has(k))).map(k => new PublicKey(k));
}
for (const [label, quoteMint, token] of [['SOL', spl.NATIVE_MINT, spl.TOKEN_PROGRAM_ID],
  ['USDC', new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), spl.TOKEN_PROGRAM_ID],
  ['Token2022 quote', key(), spl.TOKEN_2022_PROGRAM_ID]]) {
  test(`actual SDK ${label}: create -> lock -> buy validates and fits with stable ALT`, async () => {
    const f = await fixture(quoteMint, token), other = await fixture(quoteMint, token);
    // Add both full stable and existing protocol fee recipients to a realistic
    // persistent table, never mint/user-dependent accounts.
    const addresses = stable([f.instructions, other.instructions]);
    const alt = table(addresses);
    const ixs = [ComputeBudgetProgram.setComputeUnitLimit({ units: 1000000 }), ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1000 }), ...f.instructions];
    await tools.validateInstructions(ixs, f.input);
    const tx = new VersionedTransaction(new TransactionMessage({ payerKey: f.payer.publicKey, recentBlockhash: key().toBase58(), instructions: ixs }).compileToV0Message([alt]));
    tx.sign([f.payer, f.mint]);
    console.log(JSON.stringify({ label, bytes: tx.serialize().length, stableAddresses: addresses.length, instructions: ixs.length }));
    await tools.validateTransaction(tx, f.input, [alt]);
    assert.ok(tx.serialize().length <= 1232);
    const config = sdk.feeSharingConfigPda(f.mint.publicKey), buy = f.instructions.at(-1);
    assert.ok(buy.keys[16].pubkey.equals(sdk.creatorVaultPda(config)));
    assert.ok(buy.keys[18].pubkey.equals(config));
    assert.equal(new BN(buy.data.subarray(16), 'le').toString(), f.input.quoteAmountAtomic);
  });
}
test('fixed policy rejects alternative destinations, percentages and holder rewards', () => {
  assertTreasuryIntent(treasuryPolicy());
  for (const change of [{ treasuryAddress: key().toBase58() }, { treasuryShareBps: 2000 }, { holderReward: true },
    { feeRecipients: [] }, { feeRecipients: [{ type: 'creator', value: 'Creator', shareBps: 10000 }] }])
    assert.throws(() => assertTreasuryIntent({ ...treasuryPolicy(), ...change }));
});
test('on-chain state must be active, locked V2, and exclusively the intended treasury', () => {
  const mint = key(); const config = { mint, version: 2, adminRevoked: true, status: { active: {} }, shareholders: [{ address: new PublicKey(TREASURY_ADDRESS), shareBps: 10000 }] };
  assertLockedTreasuryConfig(config, mint);
  for (const patch of [{ version: 1 }, { version: 3 }, { adminRevoked: false }, { status: { paused: {} } }, { mint: key() },
    { shareholders: [{ address: key(), shareBps: 10000 }] }, { shareholders: [{ address: new PublicKey(TREASURY_ADDRESS), shareBps: 8000 }] }])
    assert.throws(() => assertLockedTreasuryConfig({ ...config, ...patch }, mint));
});
test('omitted, reordered, or tampered fee-lock instructions are rejected', async () => {
  const f = await fixture();
  for (const indexes of [[0, 3, 4], [0, 1, 3, 4, 2], [0, 2, 1, 3, 4]])
    await assert.rejects(() => tools.validateInstructions(indexes.map(i => f.instructions[i]), f.input));
  const wrong = await sdk.PUMP_SDK.updateFeeSharesV2({ authority: f.payer.publicKey, mint: f.mint.publicKey,
    currentShareholders: [f.payer.publicKey], newShareholders: [{ address: key(), shareBps: 10000 }], quoteMint: spl.NATIVE_MINT, quoteTokenProgram: spl.TOKEN_PROGRAM_ID });
  await assert.rejects(() => tools.validateInstructions([f.instructions[0], f.instructions[1], wrong, ...f.instructions.slice(3)], f.input), /treasury fee lock/);
});
test('pre-lock creator vault and overspending are rejected', async () => {
  const f = await fixture();
  const old = await sdk.PUMP_SDK.getBuyV2InstructionRaw({ user: f.payer.publicKey, mint: f.mint.publicKey, creator: f.payer.publicKey,
    amount: f.args.amount, quoteAmount: f.args.quoteAmount });
  await assert.rejects(() => tools.validateInstructions([...f.instructions.slice(0, -1), old], f.input), /post-lock first buy/);
  f.instructions.at(-1).data.writeBigUInt64LE(1000001n, 16);
  await assert.rejects(() => tools.validateInstructions(f.instructions, f.input), /spending cap/);
});
