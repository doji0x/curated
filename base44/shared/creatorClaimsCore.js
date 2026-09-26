// Shared by the Deno handler and offline tests using the pinned, real Pump SDK.
// This module never signs or submits a transaction.
export const CLAIM_WALLET = '3ggRizSixiDPXyHrEzBaZ3Nm8QfFRD1FbrkkYYpxMxkq';
export const CLAIM_MINT = '6ZdCWrLhmBJmoLCL8reNCBxqJGBxXgQyM2PcDo4kpump';
export const CLAIM_SOURCE = 'creator reward claim';
export const PURCHASES_PAUSED = 'Direct wallet-funded purchases are disabled. The reward cycle can spend only verified 80% reward allocations.';
export function claimAssert(ok, message) {
  if (!ok) throw Object.assign(new Error(message), { status: 422 });
}
export function assertClaimWallet(wallet) {
  claimAssert(wallet?.toBase58() === CLAIM_WALLET, 'ADMIN_MINT_WALLET_SECRET_KEY must resolve to the designated treasury wallet. No transaction was sent.');
}
const key = value => value.toBase58();
const normalizeQuote = (value, native, zero) => !value || value.equals(zero) ? native : value;

export function createClaimTools({ sdk, amm, spl, web3 }) {
  const { PublicKey } = web3;
  const { NATIVE_MINT, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, unpackAccount, unpackMint, getAssociatedTokenAddressSync } = spl;
  const { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, PUMP_FEE_PROGRAM_ID,
    bondingCurvePda, feeSharingConfigPda, creatorVaultPda, canonicalPumpPoolPdaWithQuote } = sdk;
  const poolCoder = sdk.getPumpAmmProgram(null).coder.accounts;

  async function inspect(connection, wallet) {
    assertClaimWallet(wallet);
    const mint = new PublicKey(CLAIM_MINT), configAddress = feeSharingConfigPda(mint);
    const [mintInfo, curveInfo, configInfo] = await connection.getMultipleAccountsInfo([mint, bondingCurvePda(mint), configAddress], 'confirmed');
    claimAssert(mintInfo && [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].some(program => mintInfo.owner.equals(program)), 'Burn mint was not found under a supported token program.');
    claimAssert(unpackMint(mint, mintInfo, mintInfo.owner).isInitialized, 'Burn mint is not initialized.');
    claimAssert(curveInfo?.owner.equals(PUMP_PROGRAM_ID), 'Burn bonding curve could not be verified.');
    const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
    const quote = normalizeQuote(curve.quoteMint, NATIVE_MINT, PublicKey.default);
    claimAssert(quote.equals(NATIVE_MINT), 'This claim action supports SOL rewards only. Other quote assets remain untouched.');
    claimAssert(!curve.isHolderReward, 'Holder rewards cannot be collected as creator rewards.');
    const poolAddress = canonicalPumpPoolPdaWithQuote(mint, quote);
    const poolInfo = await connection.getAccountInfo(poolAddress, 'confirmed');
    let pool = null;
    if (poolInfo) {
      claimAssert(poolInfo.owner.equals(PUMP_AMM_PROGRAM_ID), 'Unexpected PumpSwap pool owner.');
      pool = poolCoder.decode('pool', poolInfo.data);
      claimAssert(pool.baseMint.equals(mint) && pool.quoteMint.equals(quote) && !pool.isHolderReward, 'PumpSwap pool does not match this SOL creator-reward claim.');
      claimAssert(pool.coinCreator.equals(curve.creator), 'Curve and pool fee recipients differ. Reconcile the fee configuration before claiming.');
    } else claimAssert(!curve.complete, 'Migration is in progress. Retry after the canonical PumpSwap pool appears.');
    const creator = pool?.coinCreator || curve.creator;
    const shared = creator.equals(configAddress);
    let shareBps = 10000;
    if (shared) {
      claimAssert(configInfo?.owner.equals(PUMP_FEE_PROGRAM_ID), 'The active sharing configuration could not be verified.');
      const config = PUMP_SDK.decodeSharingConfig(configInfo);
      claimAssert(config.mint.equals(mint) && [1, 2].includes(config.version) && config.status && Object.hasOwn(config.status, 'active'), 'Unsupported or inactive creator fee-sharing configuration.');
      const shareholders = config.shareholders || [];
      claimAssert(shareholders.length > 0 && shareholders.every(row => Number.isInteger(row.shareBps) && row.shareBps > 0) &&
        shareholders.reduce((sum, row) => sum + row.shareBps, 0) === 10000 && new Set(shareholders.map(row => key(row.address))).size === shareholders.length,
      'Invalid creator fee-sharing allocation.');
      shareBps = shareholders.find(row => row.address.equals(wallet))?.shareBps || 0;
      claimAssert(shareBps > 0, 'The treasury wallet is not a recipient of this coin’s creator rewards.');
    } else claimAssert(creator.equals(wallet), 'This coin’s direct creator rewards do not belong to the configured treasury wallet.');

    const pumpVault = creatorVaultPda(creator);
    const ammAuthority = amm.coinCreatorVaultAuthorityPda(creator);
    const ammVault = amm.coinCreatorVaultAtaPda(ammAuthority, quote, TOKEN_PROGRAM_ID);
    const [pumpInfo, ammInfo] = await connection.getMultipleAccountsInfo([pumpVault, ammVault], 'confirmed');
    // The Pump PDA is a system-owned SOL vault, not a Pump-owned data account.
    claimAssert(!pumpInfo || (!pumpInfo.executable && pumpInfo.owner.equals(web3.SystemProgram.programId) && pumpInfo.data.length === 0), 'Unexpected Pump creator-vault owner.');
    const rent = pumpInfo ? await connection.getMinimumBalanceForRentExemption(pumpInfo.data.length) : 0;
    claimAssert(!pumpInfo || Number.isSafeInteger(pumpInfo.lamports), 'RPC returned an inexact SOL vault balance.');
    const pumpAmount = pumpInfo ? BigInt(Math.max(0, pumpInfo.lamports - rent)) : 0n;
    let ammAmount = 0n;
    if (ammInfo) {
      const account = unpackAccount(ammVault, ammInfo, TOKEN_PROGRAM_ID);
      claimAssert(account.mint.equals(quote) && account.owner.equals(ammAuthority) && account.isInitialized && !account.isFrozen && account.isNative,
        'Unexpected PumpSwap SOL reward account.');
      ammAmount = account.amount;
    }
    claimAssert(pool || ammAmount === 0n, 'AMM rewards exist without a canonical pool; reconcile before claiming.');
    const total = pumpAmount + ammAmount;
    return { route: shared ? 'sharing' : 'direct', claimScope: shared ? 'mint' : 'creator-wallet',
      coinMint: CLAIM_MINT, attributedMint: shared ? CLAIM_MINT : '', quoteMint: key(quote), wallet: key(wallet),
      creator: key(creator), sharingConfig: shared ? key(configAddress) : '', shareBps, graduated: Boolean(pool),
      pumpVault: key(pumpVault), ammVault: key(ammVault), recipientAta: key(getAssociatedTokenAddressSync(quote, wallet)),
      pumpAmount: String(pumpAmount), ammAmount: String(ammAmount), estimatedClaim: String(total * BigInt(shareBps) / 10000n),
      notice: shared ? 'Estimated SOL payable to this wallet from Burn’s fee-sharing vaults.' :
        'This creator-wallet vault can include rewards from multiple coins. The receipt will not attribute the whole claim to Burn.' };
  }

  async function prepareInstructions(connection, online, wallet) {
    const plan = await inspect(connection, wallet);
    if (BigInt(plan.estimatedClaim) === 0n) return { skipped: true, reason: 'No claimable SOL creator rewards.', claim: plan };
    let instructions;
    if (plan.route === 'sharing') {
      const minimum = await online.getMinimumDistributableFee(new PublicKey(plan.coinMint), wallet, { quoteMint: NATIVE_MINT });
      if (!minimum.canDistribute) return { skipped: true, reason: 'Rewards are below Pump’s distribution minimum. They remain in the vault for the next claim.', claim: plan };
      ({ instructions } = await online.buildDistributeCreatorFeesInstructions(new PublicKey(plan.coinMint), { quoteMint: NATIVE_MINT, quoteTokenProgram: TOKEN_PROGRAM_ID, payer: wallet }));
    } else {
      // The helper includes both programs. Keep Pump only when it has SOL;
      // keep AMM/ATA/unwrap instructions only when that vault has rewards.
      const all = await online.collectCoinCreatorFeeV2Instructions(wallet, NATIVE_MINT, TOKEN_PROGRAM_ID, wallet);
      instructions = all.filter(ix => ix.programId.equals(PUMP_PROGRAM_ID) ? BigInt(plan.pumpAmount) > 0n : BigInt(plan.ammAmount) > 0n);
    }
    claimAssert(instructions.length > 0, 'The SDK returned no collection instructions.');
    return { instructions, claim: plan };
  }
  return { inspect, prepareInstructions };
}

// Receipt inputs are finalized transaction metadata, never current wallet balance.
// Direct collections account for SDK WSOL unwrap/rent separately. Sharing claims
// have no treasury ATA creation or unwrap; the treasury pays only the network fee.
export function claimReceipt(meta, keys, plan) {
  claimAssert(meta && !meta.err, 'A failed transaction cannot create a claim receipt.');
  const index = address => keys.indexOf(address);
  const balance = (list, i) => { claimAssert(i >= 0 && Number.isSafeInteger(list?.[i]), 'Claim receipt is missing exact account balances.'); return BigInt(list[i]); };
  const walletIndex = index(plan.wallet);
  claimAssert(Number.isSafeInteger(meta.fee), 'Claim receipt is missing the network fee.');
  let received = balance(meta.postBalances, walletIndex) - balance(meta.preBalances, walletIndex) + BigInt(meta.fee);
  let rentRefund = 0n, unwrappedExisting = 0n;
  const sourceIndex = index(plan.pumpVault), ammIndex = index(plan.ammVault);
  claimAssert(BigInt(plan.pumpAmount) === 0n || sourceIndex >= 0, 'Claim receipt is missing the Pump reward vault.');
  let distributed = sourceIndex < 0 ? 0n : balance(meta.preBalances, sourceIndex) - balance(meta.postBalances, sourceIndex);
  const tokenAmount = (list, i, required = false) => {
    const row = list?.find(item => item.accountIndex === i);
    claimAssert(!required || row, 'Claim receipt is missing the reward token account.');
    if (!row) return 0n;
    claimAssert(row.mint === plan.quoteMint && /^\d+$/.test(row.uiTokenAmount?.amount), 'Unexpected quote asset in claim receipt.');
    return BigInt(row.uiTokenAmount.amount);
  };
  claimAssert(BigInt(plan.ammAmount) === 0n || ammIndex >= 0, 'Claim receipt is missing the AMM reward vault.');
  if (ammIndex >= 0) {
    // A vault empty at preparation can accrue before this transaction lands.
    distributed += tokenAmount(meta.preTokenBalances, ammIndex, BigInt(plan.ammAmount) > 0n) - tokenAmount(meta.postTokenBalances, ammIndex);
  }
  if (plan.route === 'direct' && BigInt(plan.ammAmount) > 0n) {
    const ata = index(plan.recipientAta);
    claimAssert(ata >= 0, 'Claim receipt is missing the WSOL destination.');
    const pre = balance(meta.preBalances, ata), post = balance(meta.postBalances, ata);
    unwrappedExisting = tokenAmount(meta.preTokenBalances, ata);
    rentRefund = pre - unwrappedExisting - post;
    received += post - pre;
  }
  claimAssert(received >= 0n && distributed >= 0n && received <= distributed, 'Claim receipt amounts do not reconcile. Further claims are blocked for review.');
  if (plan.shareBps === 10000) claimAssert(received === distributed, 'The treasury receipt does not match the collected vault rewards.');
  return { totalAccrued: String(received), totalDistributed: String(distributed), networkFee: String(meta.fee),
    rentRefund: String(rentRefund), unwrappedExisting: String(unwrappedExisting), remainingBalance: String(meta.postBalances[walletIndex]),
    coinsReceived: '0', sweptAmount: '0' };
}
