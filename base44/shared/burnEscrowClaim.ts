import { Buffer } from 'node:buffer';
import { PublicKey, SystemProgram, TransactionMessage, VersionedTransaction } from 'npm:@solana/web3.js@1.98.4';
import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_FEE_PROGRAM_ID, feeSharingConfigPda, creatorVaultPda, bondingCurvePda } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { CLAIM_MINT, assertClaimWallet, claimAssert } from './creatorClaimsCore.js';
import { solMint } from './burnBuybackConfig.ts';

export const escrowAddress = 'GHQx9fVKLxsLvimRHtH2zEmQh83JnwRipgiw6CVpwAS8';
export const claimLookupTable = 'Hyif6eWb8x88RVrvjPfabsgRYnwkVnyByEXTVTXbUcyP';
export async function inspectBurnEscrow(ctx) {
  const { connection, wallet } = ctx;
  assertClaimWallet(wallet.publicKey);
  const mint = new PublicKey(CLAIM_MINT), sharingConfigAddress = feeSharingConfigPda(mint);
  const escrow = creatorVaultPda(sharingConfigAddress);
  claimAssert(escrow.toBase58() === escrowAddress, 'Burn fee escrow does not match the verified claim source.');
  const [configInfo, curveInfo, escrowInfo] = await connection.getMultipleAccountsInfo([sharingConfigAddress, bondingCurvePda(mint), escrow], 'confirmed');
  claimAssert(configInfo?.owner.equals(PUMP_FEE_PROGRAM_ID), 'Burn fee-sharing configuration is unavailable.');
  const sharingConfig = PUMP_SDK.decodeSharingConfig(configInfo);
  claimAssert(sharingConfig.mint.equals(mint) && [1, 2].includes(sharingConfig.version) && sharingConfig.status && Object.hasOwn(sharingConfig.status, 'active'), 'Burn fee-sharing configuration is not active.');
  claimAssert(sharingConfig.shareholders.length === 1 && sharingConfig.shareholders[0].address.equals(wallet.publicKey) && sharingConfig.shareholders[0].shareBps === 10000, 'Escrow recipients have changed from the verified treasury-only claim. No transaction was sent.');
  claimAssert(curveInfo?.owner.equals(PUMP_PROGRAM_ID), 'Burn bonding curve could not be verified.');
  const curve = PUMP_SDK.decodeBondingCurve(curveInfo);
  claimAssert(!curve.isHolderReward && (!curve.quoteMint || curve.quoteMint.equals(PublicKey.default) || curve.quoteMint.toBase58() === solMint), 'This action claims native SOL escrow rewards only.');
  claimAssert(!escrowInfo || (!escrowInfo.executable && escrowInfo.owner.equals(SystemProgram.programId) && escrowInfo.data.length === 0 && Number.isSafeInteger(escrowInfo.lamports)), 'Unexpected fee escrow account.');
  const rent = await connection.getMinimumBalanceForRentExemption(0);
  const available = escrowInfo ? BigInt(Math.max(0, escrowInfo.lamports - rent)) : 0n;
  const claim = { route: 'escrow', escrowOnly: true, retainInWallet: true, claimScope: 'mint', coinMint: CLAIM_MINT, attributedMint: CLAIM_MINT, quoteMint: solMint,
    wallet: wallet.publicKey.toBase58(), sharingConfig: sharingConfigAddress.toBase58(), shareBps: 10000, graduated: Boolean(curve.complete),
    escrow: escrowAddress, pumpVault: escrowAddress, ammVault: '', recipientAta: '', pumpAmount: String(available), ammAmount: '0', escrowRent: String(rent),
    estimatedClaim: String(available), notice: 'Claimable native SOL in Burn’s fee escrow, excluding rent. Wallet funds and AMM rewards are not included.' };
  return { mint, sharingConfig, sharingConfigAddress, claim };
}

export async function prepareEscrowInstructions(ctx) {
  const inspected = await inspectBurnEscrow(ctx);
  const { claim, mint, sharingConfig, sharingConfigAddress } = inspected;
  if (BigInt(claim.estimatedClaim) === 0n) return { skipped: true, reason: 'No claimable SOL is currently in the Burn fee escrow.', claim };
  // Use the SOL-only view directly: the online convenience helper can consolidate AMM funds.
  const view = await PUMP_SDK.getMinimumDistributableFee({ mint, sharingConfig, sharingConfigAddress });
  const { blockhash } = await ctx.connection.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: ctx.wallet.publicKey, recentBlockhash: blockhash, instructions: [view] }).compileToV0Message());
  const simulation = await ctx.connection.simulateTransaction(tx, { commitment: 'confirmed', sigVerify: false });
  claimAssert(!simulation.value.err, `Escrow distribution check failed: ${JSON.stringify(simulation.value.err)}`);
  const returned = simulation.value.returnData;
  claimAssert(returned?.programId === PUMP_PROGRAM_ID.toBase58() && returned.data?.[1] === 'base64', 'Pump did not return its escrow distribution minimum.');
  const minimum = PUMP_SDK.decodeMinimumDistributableFee(Buffer.from(returned.data[0], 'base64'));
  if (!minimum.canDistribute) return { skipped: true, reason: 'Escrow rewards are below Pump’s distribution minimum; SOL remains in escrow.', claim };
  const instruction = await PUMP_SDK.distributeCreatorFees({ mint, sharingConfig, sharingConfigAddress });
  const expected = [CLAIM_MINT, bondingCurvePda(mint).toBase58(), sharingConfigAddress.toBase58(), escrowAddress, SystemProgram.programId.toBase58(), 'Ce6TQqeHC9p8KetsN6JsjHK7UTZk7nasjjnr7XxXp9F1', PUMP_PROGRAM_ID.toBase58(), claim.wallet];
  claimAssert(instruction.programId.equals(PUMP_PROGRAM_ID) && Buffer.from(instruction.data).equals(Buffer.from([165, 114, 103, 0, 121, 206, 247, 81])) && instruction.keys.length === expected.length && instruction.keys.every((row, i) => row.pubkey.toBase58() === expected[i] && !row.isSigner && row.isWritable === [3, 7].includes(i)), 'Distribution instruction differs from the verified claim transaction.');
  return { claim, instructions: [instruction] };
}