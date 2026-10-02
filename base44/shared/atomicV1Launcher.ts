import { secrets } from 'base44:runtime';
import { Buffer } from 'node:buffer';
import { Connection, Keypair, PublicKey } from 'npm:@solana/web3.js@1.98.4';
import { OnlinePumpSdk, PUMP_SDK, bondingCurvePda, getBuyTokenAmountFromSolAmount } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { parseWallet, rpcRequest, adminWalletSecretName } from './mintWallet.ts';
import { launchMint, isLaunched } from './pumpLaunch.ts';
import { atomicAmount } from './pumpBuy.ts';
import { detectImageMime, isCompleteImage } from './imageMime.ts';
import { buildAtomicV1Transaction, atomicV1MaxBytes } from './atomicV1Launch.ts';
import { inspectV1Transaction } from './v1Transaction.ts';
import { cleanSocials } from './launchSocials.ts';
import { atomicV1PumpInstructions, defaultV1Quote } from './atomicV1Rewards.ts';
import { tokenBalance } from './pumpPairs.ts';

const solMint = new PublicKey('So11111111111111111111111111111111111111112');
const appUrl = 'https://solvalidate.base44.app';
export const requestPattern = /^[0-9a-f-]{36}$/i;
export const addressPattern = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
// Base64 payload cap; the practical raw-image limit is three quarters of it.
const maxImageBase64Chars = 10000;

export function cleanAtomicV1Input(body) {
  return { requestId: String(body.requestId || ''), name: String(body.name || '').trim(), symbol: String(body.symbol || '').trim().toUpperCase(), description: String(body.description || '').trim(), firstBuyAmount: String(body.firstBuyAmount || '').trim(), quoteMint: String(body.quoteMint || defaultV1Quote), holderReward: body.holderReward === true, creatorFeeBps: Math.round(Number(body.creatorFeePercent || 0) * 100) };
}

export function atomicV1InputError(input) {
  if (!requestPattern.test(input.requestId)) return 'Reload the page and start the launch again.';
  if (!input.name || Buffer.byteLength(input.name) > 32) return 'Enter a coin name of 32 bytes or fewer.';
  if (!input.symbol || Buffer.byteLength(input.symbol) > 10) return 'Enter a ticker of 10 characters or fewer.';
  if (input.description.length > 280) return 'Shorten the description to 280 characters.';
  if (!addressPattern.test(input.quoteMint)) return 'Choose a supported pair asset.';
  if (!Number.isInteger(input.creatorFeeBps) || input.creatorFeeBps < 0) return 'Enter a valid creator fee percentage.';
  if (input.firstBuyAmount && (!/^\d+(\.\d+)?$/.test(input.firstBuyAmount) || Number(input.firstBuyAmount) <= 0)) return 'Enter a positive first buy in the selected pair asset.';
  return '';
}

// Returns { error, status, ... } for a rejected image, or { imageBytes, imageMime }.
export function readAtomicV1Image(imageBase64) {
  if (typeof imageBase64 !== 'string' || !imageBase64) return { error: 'Select an image file before calculating the transaction size.', status: 400 };
  if (imageBase64.length > maxImageBase64Chars) {
    const bytes = Math.floor(imageBase64.length * 3 / 4), maxBytes = Math.floor(maxImageBase64Chars * 3 / 4);
    return { error: `That image is ${bytes.toLocaleString()} bytes, over the ${maxBytes.toLocaleString()}-byte limit for an atomic V1 launch. Shrink it by at least ${(bytes - maxBytes).toLocaleString()} bytes.`, status: 413, imageBytesCount: bytes, maxImageBytes: maxBytes };
  }
  const imageBytes = Buffer.from(imageBase64, 'base64');
  const imageMime = detectImageMime(imageBytes);
  if (!imageMime || !isCompleteImage(imageBytes, imageMime)) return { error: 'Upload a complete PNG, JPEG, GIF, or WebP image.', status: 400 };
  return { imageBytes, imageMime };
}

export async function pumpInstructions(args) {
  return atomicV1PumpInstructions(args);
}

// Shared Atomic V1 engine. `action` is 'size' or 'launch'; `extraRecord` lets the public
// path store the requesting wallet on the launch record.
export async function runAtomicV1Launch({ entities, rpcUrl, body, input, imageBytes, imageMime, ownerId, action, creatorAddress = '', extraRecord = {} }) {
  if (action === 'launch') {
    const [existing] = await entities.AtomicV1Launch.filter({ requestId: input.requestId });
    if (existing?.transactionSignature) return { launch: existing };
  }
  const walletBytes = parseWallet(secrets.get(adminWalletSecretName), adminWalletSecretName);
  const wallet = Keypair.fromSecretKey(walletBytes);
  const mint = await launchMint(walletBytes, ownerId, { ...input, inscribedMint: 'atomic-v1' });
  const coinMint = mint.publicKey.toBase58();
  const bondingCurve = bondingCurvePda(mint.publicKey).toBase58();
  const metadataUri = `${appUrl}/functions/atomicV1Metadata?mint=${coinMint}`;
  // The launching wallet is recorded on-chain as the coin creator; the app wallet only pays and signs.
  const creator = creatorAddress ? new PublicKey(creatorAddress) : wallet.publicKey;
  const legacyInstructions = await pumpInstructions({ rpcUrl, mintKey: mint.publicKey, input, metadataUri, creator, payer: wallet.publicKey });
  const latest = (await rpcRequest(rpcUrl, 'getLatestBlockhash', [{ commitment: 'confirmed' }])).value;
  const built = await buildAtomicV1Transaction({ legacyInstructions, payerBytes: walletBytes, mintBytes: mint.secretKey, latest, mint: coinMint, imageBytes });
  const size = { imageBytes: built.imageBytes, commitmentBytes: built.commitmentBytes, transactionBytesWithoutImage: built.transactionBytesWithoutImage, finalSerializedTransactionBytes: built.size, maximumBytes: atomicV1MaxBytes, remainingBytes: built.remainingBytes, requiredReductionBytes: built.requiredReductionBytes, coinMint, imageSha256: built.imageSha256 };
  if (action === 'size') return { size };
  if (built.size > atomicV1MaxBytes) return { status: 422, error: `The signed V1 transaction is ${built.size} bytes. Remove exactly ${built.requiredReductionBytes} bytes from the image before launching.`, size };
  if (typeof body.imageUrl !== 'string' || !/^https:\/\//.test(body.imageUrl)) return { status: 400, error: 'The public Pump image upload is missing.' };

  const balance = (await rpcRequest(rpcUrl, 'getBalance', [wallet.publicKey.toBase58(), { commitment: 'confirmed' }])).value;
  const buyLamports = input.firstBuyAmount && input.quoteMint === defaultV1Quote ? BigInt(atomicAmount(input.firstBuyAmount, 9).toString()) : 0n;
  if (input.firstBuyAmount && input.quoteMint !== defaultV1Quote) {
    const quote = await new OnlinePumpSdk(new Connection(rpcUrl, 'confirmed')).resolveQuoteMint(new PublicKey(input.quoteMint));
    if (await tokenBalance(rpcUrl, wallet.publicKey.toBase58(), input.quoteMint) < BigInt(atomicAmount(input.firstBuyAmount, quote.decimals).toString())) return { status: 422, error: 'The admin launch wallet lacks the selected pair asset for this first buy.' };
  }
  if (BigInt(balance) < 30_000_000n + buyLamports) return { status: 422, error: 'The launch wallet needs the first-buy amount plus about 0.03 SOL for rent and fees. Try again with a smaller first buy.' };
  let [launch] = await entities.AtomicV1Launch.filter({ requestId: input.requestId });
  const record = { requestId: input.requestId, coinMint, bondingCurve, name: input.name, symbol: input.symbol, description: input.description, imageUrl: body.imageUrl, imageMime, imageByteLength: imageBytes.length, imageSha256: built.imageSha256, metadataUri, socials: cleanSocials(body.socials), transactionVersion: 1, serializedTransactionBytes: built.size, commitment: 'VALIDATE-v1', atomicV1Verified: false, firstBuyAmount: input.firstBuyAmount, quoteMint: input.quoteMint, creatorFeeBps: input.creatorFeeBps, holderReward: input.holderReward, status: 'prepared', error: '', lastValidBlockHeight: latest.lastValidBlockHeight, checkedAt: new Date().toISOString(), ...extraRecord };
  launch = launch ? await entities.AtomicV1Launch.update(launch.id, record) : await entities.AtomicV1Launch.create(record);
  const simulation = (await rpcRequest(rpcUrl, 'simulateTransaction', [built.encoded, { encoding: 'base64', commitment: 'confirmed', sigVerify: true }])).value;
  if (simulation.err) return { status: 422, error: `Atomic V1 simulation failed, so nothing was sent: ${JSON.stringify(simulation.err)}`, logs: simulation.logs };
  const computeUnitLimit = Math.min(1_400_000, Math.max(200_000, Math.ceil((simulation.unitsConsumed || 600_000) * 1.2)));
  const finalBuilt = await buildAtomicV1Transaction({ legacyInstructions, payerBytes: walletBytes, mintBytes: mint.secretKey, latest, mint: coinMint, imageBytes, computeUnitLimit });
  const finalSimulation = (await rpcRequest(rpcUrl, 'simulateTransaction', [finalBuilt.encoded, { encoding: 'base64', commitment: 'confirmed', sigVerify: true }])).value;
  if (finalSimulation.err) return { status: 422, error: `Atomic V1 resource-adjusted simulation failed, so nothing was sent: ${JSON.stringify(finalSimulation.err)}`, logs: finalSimulation.logs };
  launch = await entities.AtomicV1Launch.update(launch.id, { transactionSignature: finalBuilt.signature, serializedTransactionBytes: finalBuilt.size, status: 'pending', checkedAt: new Date().toISOString() });
  try { await rpcRequest(rpcUrl, 'sendTransaction', [finalBuilt.encoded, { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 2 }]); }
  catch (error) { launch = await entities.AtomicV1Launch.update(launch.id, { error: `Submission is unconfirmed. Check the saved signature before launching again. ${error.message}` }); }
  return { launch, size };
}

export async function confirmAtomicV1Launch(entities, rpcUrl, launch) {
  if (launch.status !== 'pending') return launch;
  const state = (await rpcRequest(rpcUrl, 'getSignatureStatuses', [[launch.transactionSignature], { searchTransactionHistory: true }])).value[0];
  if (state?.err) return await entities.AtomicV1Launch.update(launch.id, { status: 'failed', error: `Atomic transaction failed: ${JSON.stringify(state.err)}`, checkedAt: new Date().toISOString() });
  if (!state && launch.lastValidBlockHeight && await rpcRequest(rpcUrl, 'getBlockHeight', [{ commitment: 'finalized' }]) > launch.lastValidBlockHeight) {
    const again = (await rpcRequest(rpcUrl, 'getSignatureStatuses', [[launch.transactionSignature], { searchTransactionHistory: true }])).value[0];
    if (!again) return entities.AtomicV1Launch.update(launch.id, { status: 'expired', error: 'The transaction expired without confirmation. No verified launch was recorded.', checkedAt: new Date().toISOString() });
  }
  if (state?.confirmationStatus !== 'finalized') return launch;
  const proof = await inspectV1Transaction(launch.transactionSignature, launch.coinMint);
  const verified = proof.status === 'valid' && proof.hash === launch.imageSha256 && proof.bytes === launch.imageByteLength && proof.commitment === 'VALIDATE-v1';
  const landed = await isLaunched(rpcUrl, launch.coinMint, launch.bondingCurve);
  return await entities.AtomicV1Launch.update(launch.id, { status: verified && landed ? 'confirmed' : 'incomplete', atomicV1Verified: verified && landed, error: verified && landed ? '' : 'The Pump coin or VALIDATE-v1 image could not be independently verified from the finalized launch transaction.', checkedAt: new Date().toISOString() });
}