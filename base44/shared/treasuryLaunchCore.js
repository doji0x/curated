import { TREASURY_ADDRESS, TREASURY_POLICY_VERSION, treasuryPolicy, assertTreasuryIntent,
  assertLockedTreasuryConfig, policyAssert as requirePolicy } from './treasuryPolicy.js';

const key = value => value.toBase58();
const equal = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const normalize = value => value.replace(/_/g, '').toLowerCase();

/** One implementation for Node tests, the browser, and Deno. No wallet secrets,
 * ambient RPC or submission occurs here. The pinned official SDK builds accounts.
 */
export function createTreasuryTools({ sdk, spl, web3, BN }) {
  const { PublicKey, TransactionMessage, VersionedTransaction, ComputeBudgetProgram } = web3;
  const { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, feeSharingConfigPda,
    creatorVaultPda, bondingCurvePda, canonicalPumpPoolPdaWithQuote } = sdk;
  const { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, getAssociatedTokenAddressSync,
    createAssociatedTokenAccountIdempotentInstruction } = spl;
  const treasury = new PublicKey(TREASURY_ADDRESS);
  const pump = sdk.getPumpProgram(null), fees = sdk.getPumpFeeProgram(null), amm = sdk.getPumpAmmProgram(null);
  function layout(program, name) {
    const ix = program.idl.instructions.find(item => normalize(item.name) === normalize(name));
    requirePolicy(ix && ix.accounts.every(a => !a.accounts), `Unsupported SDK instruction layout: ${name}`);
    return ix;
  }
  function namedAccount(ix, name, program = pump, instruction = 'buyV2') {
    const index = layout(program, instruction).accounts.findIndex(a => normalize(a.name) === normalize(name));
    requirePolicy(index >= 0 && ix.keys[index], `Missing ${name} in ${instruction}.`);
    return ix.keys[index].pubkey;
  }
  function match(actual, expected, label) {
    // Decompilation promotes privileges across ALL instructions. Require the
    // expected privileges; validate the complete signer set separately.
    requirePolicy(actual && actual.programId.equals(expected.programId) && equal(actual.data, expected.data) &&
      actual.keys.length === expected.keys.length && actual.keys.every((a, i) => a.pubkey.equals(expected.keys[i].pubkey) &&
        (!expected.keys[i].isSigner || a.isSigner) && (!expected.keys[i].isWritable || a.isWritable)),
    `Prepared transaction differs from the approved ${label}.`);
  }
  const asBN = value => new BN(String(value));
  function quoteSpec(input) {
    const mint = new PublicKey(input.quoteMint), program = new PublicKey(input.quoteTokenProgram);
    requirePolicy([TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some(p => p.equals(program)), 'Unsupported quote token program.');
    requirePolicy(!mint.equals(NATIVE_MINT) || program.equals(TOKEN_PROGRAM_ID), 'SOL quote must use SPL Token.');
    return { mint, program };
  }
  async function lockInstructions({ mint, user, quoteMint, quoteTokenProgram }) {
    const config = feeSharingConfigPda(mint);
    const initialize = await PUMP_SDK.createFeeSharingConfig({ creator: user, mint, pool: null });
    const update = await PUMP_SDK.updateFeeSharesV2({ authority: user, mint, currentShareholders: [user],
      newShareholders: [{ address: treasury, shareBps: 10000 }], quoteMint, quoteTokenProgram });
    const ensureAtas = [];
    if (!quoteMint.equals(NATIVE_MINT)) {
      const owners = [creatorVaultPda(config), namedAccount(update, 'coinCreatorVaultAuthority', fees, 'updateFeeSharesV2')];
      for (const owner of owners) ensureAtas.push(createAssociatedTokenAccountIdempotentInstruction(user,
        getAssociatedTokenAddressSync(quoteMint, owner, true, quoteTokenProgram), owner, quoteMint, quoteTokenProgram));
    }
    return [initialize, ...ensureAtas, update];
  }
  async function build({ global, mint, user, name, symbol, uri, amount, quoteAmount, quoteMint,
    quoteTokenProgram = TOKEN_PROGRAM_ID, creatorFeeBps }) {
    requirePolicy(amount.gt(new BN(0)) && quoteAmount.gt(new BN(0)), 'A positive first buy is required.');
    const original = await PUMP_SDK.createV2AndBuyV2Instructions({ global, mint, user, creator: user,
      name, symbol, uri, amount, quoteAmount, quoteMint, quoteTokenProgram, creatorFeeBps,
      mayhemMode: false, holderReward: false, cashback: false });
    requirePolicy(original.length === 3, 'Pump create-and-buy layout changed; update the treasury builder and tests.');
    const buy = await PUMP_SDK.getBuyV2InstructionRaw({ user, mint, creator: feeSharingConfigPda(mint),
      amount, quoteAmount, quoteMint, quoteTokenProgram, tokenProgram: TOKEN_2022_PROGRAM_ID,
      feeRecipient: namedAccount(original[2], 'feeRecipient'), buybackFeeRecipient: namedAccount(original[2], 'buybackFeeRecipient') });
    // quoteAmount is the user's cap, without the helper's additional 1%.
    return [original[0], ...await lockInstructions({ mint, user, quoteMint, quoteTokenProgram }), original[1], buy];
  }
  async function validateInstructions(instructions, input) {
    assertTreasuryIntent(input);
    const mint = new PublicKey(input.coinMint), user = new PublicKey(input.walletAddress), quote = quoteSpec(input);
    const budget = asBN(input.quoteAmountAtomic), minimum = asBN(input.minimumTokens);
    requirePolicy(budget.gt(new BN(0)) && minimum.gt(new BN(0)), 'Missing bounded first-buy intent.');
    const body = [...instructions];
    if (body[0]?.programId.equals(ComputeBudgetProgram.programId)) {
      requirePolicy(body.length > 2 && body[0].data.length === 5 && body[0].data[0] === 2 &&
        body[1].programId.equals(ComputeBudgetProgram.programId) && body[1].data.length === 9 && body[1].data[0] === 3,
      'Unexpected compute-budget instructions.');
      const units = new DataView(body[0].data.buffer, body[0].data.byteOffset, 5).getUint32(1, true);
      const price = new DataView(body[1].data.buffer, body[1].data.byteOffset, 9).getBigUint64(1, true);
      requirePolicy(units > 0 && units <= 1400000 && price <= 1000n && !body[0].keys.length && !body[1].keys.length,
        'Unexpected compute budget or priority fee.');
      body.splice(0, 2);
    }
    const create = await PUMP_SDK.createV2Instruction({ mint, user, creator: user, name: input.name, symbol: input.symbol,
      uri: input.metadataUrl || input.metadataUri, mayhemMode: false, cashback: false, holderReward: false,
      creatorFeeBps: input.creatorFeeBps ? asBN(input.creatorFeeBps) : undefined,
      quoteMint: quote.mint, quoteTokenProgram: quote.program });
    const locks = await lockInstructions({ mint, user, quoteMint: quote.mint, quoteTokenProgram: quote.program });
    requirePolicy(body.length === locks.length + 3, 'Unexpected or missing launch/fee-lock instructions.');
    match(body[0], create, 'coin creation');
    for (let i = 0; i < locks.length; i++) match(body[i + 1], locks[i], 'treasury fee lock');
    const ata = createAssociatedTokenAccountIdempotentInstruction(user,
      getAssociatedTokenAddressSync(mint, user, true, TOKEN_2022_PROGRAM_ID), user, mint, TOKEN_2022_PROGRAM_ID);
    match(body.at(-2), ata, 'first-buy recipient');
    const buy = body.at(-1);
    requirePolicy(buy.programId.equals(PUMP_PROGRAM_ID) && buy.data.length === 24 &&
      equal(buy.data.subarray(0, 8), layout(pump, 'buyV2').discriminator), 'Unexpected first-buy instruction.');
    const values = pump.coder.instruction.decode(buy.data).data;
    requirePolicy(values.amount.eq(minimum) && values.maxSolCost.eq(budget), 'First-buy output or spending cap changed.');
    const expectedBuy = await PUMP_SDK.getBuyV2InstructionRaw({ mint, user, creator: feeSharingConfigPda(mint),
      amount: minimum, quoteAmount: budget, quoteMint: quote.mint, quoteTokenProgram: quote.program,
      tokenProgram: TOKEN_2022_PROGRAM_ID, feeRecipient: namedAccount(buy, 'feeRecipient'),
      buybackFeeRecipient: namedAccount(buy, 'buybackFeeRecipient') });
    match(buy, expectedBuy, 'post-lock first buy');
    return true;
  }
  async function validateTransaction(transaction, input, lookupTables = []) {
    requirePolicy(transaction.version === 0 && transaction.signatures.length === 2 &&
      transaction.message.header.numRequiredSignatures === 2 && transaction.message.header.numReadonlySignedAccounts === 0 &&
      key(transaction.message.staticAccountKeys[0]) === input.walletAddress &&
      key(transaction.message.staticAccountKeys[1]) === input.coinMint, 'Unexpected launch transaction signers or version.');
    requirePolicy(transaction.serialize().length <= 1232, 'Treasury launch exceeds the V0 transaction limit.');
    const decoded = TransactionMessage.decompile(transaction.message, { addressLookupTableAccounts: lookupTables });
    requirePolicy(key(decoded.payerKey) === input.walletAddress, 'Unexpected launch fee payer.');
    return validateInstructions(decoded.instructions, input);
  }
  async function verify(connection, mintAddress, expectedQuote, commitment = 'finalized') {
    const mint = new PublicKey(mintAddress), configAddress = feeSharingConfigPda(mint), curveAddress = bondingCurvePda(mint);
    const [configInfo, curveInfo] = await connection.getMultipleAccountsInfo([configAddress, curveAddress], commitment);
    requirePolicy(configInfo?.owner.equals(PUMP_FEE_PROGRAM_ID) && curveInfo?.owner.equals(PUMP_PROGRAM_ID),
      'Treasury fee configuration or curve has not been observed on-chain.');
    const config = PUMP_SDK.decodeSharingConfig(configInfo), curve = PUMP_SDK.decodeBondingCurve(curveInfo);
    assertLockedTreasuryConfig(config, mint);
    requirePolicy(curve.creator.equals(configAddress) && !curve.isHolderReward, 'Curve creator fees no longer use the treasury configuration.');
    const quoteMint = !curve.quoteMint || curve.quoteMint.equals(PublicKey.default) ? NATIVE_MINT : curve.quoteMint;
    requirePolicy(!expectedQuote || quoteMint.equals(new PublicKey(expectedQuote)), 'Unexpected fee quote mint.');
    const poolAddress = canonicalPumpPoolPdaWithQuote(mint, quoteMint);
    const poolInfo = await connection.getAccountInfo(poolAddress, commitment);
    if (poolInfo) {
      requirePolicy(poolInfo.owner.equals(PUMP_AMM_PROGRAM_ID), 'Unexpected canonical pool owner.');
      const pool = amm.coder.accounts.decode('pool', poolInfo.data);
      requirePolicy(pool.baseMint.equals(mint) && pool.quoteMint.equals(quoteMint) &&
        pool.coinCreator.equals(configAddress) && !pool.isHolderReward, 'Graduated pool does not preserve the treasury reward policy.');
    } else requirePolicy(!curve.complete, 'Graduation is in progress; retry treasury verification after the canonical pool appears.');
    const quoteInfo = await connection.getAccountInfo(quoteMint, commitment);
    requirePolicy(quoteInfo && [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some(p => p.equals(quoteInfo.owner)), 'Unsupported reward quote mint.');
    return { ...treasuryPolicy(), sharingConfigAddress: key(configAddress), config, curve,
      quoteMint: key(quoteMint), quoteTokenProgram: key(quoteInfo.owner), graduated: Boolean(poolInfo),
      feeLockStatus: 'verified', feeLockVerifiedAt: new Date().toISOString() };
  }
  return { build, validateInstructions, validateTransaction, verify, lockInstructions, treasury,
    configAddress: mint => feeSharingConfigPda(new PublicKey(mint)), policyVersion: TREASURY_POLICY_VERSION,
    decode: bytes => VersionedTransaction.deserialize(bytes) };
}
