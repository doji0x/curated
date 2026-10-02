import { Buffer } from 'node:buffer';
import { PublicKey } from 'npm:@solana/web3.js@1.98.4';
import { fromLegacyTransactionInstruction } from 'npm:@solana/compat@8.0.0';
import {
  addSignersToTransactionMessage, address, appendTransactionMessageInstructions,
  assertIsFullySignedTransaction, assertIsTransactionWithinSizeLimit,
  createKeyPairSignerFromBytes, createTransactionMessage, getBase64EncodedWireTransaction,
  getTransactionSize, getSignatureFromTransaction, pipe, setTransactionMessageConfig, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, signTransactionMessageWithSigners
} from 'npm:@solana/kit@8.0.0';

export const atomicV1MaxBytes = 4096;
export const commitmentHeaderBytes = 73;
const noopProgram = 'noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV';
const computeBudgetProgram = 'ComputeBudget111111111111111111111111111111';

export async function commitmentPayload(mint, imageBytes) {
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', imageBytes));
  const payload = Buffer.concat([Buffer.from('VALIDATE', 'ascii'), Buffer.from([1]), new PublicKey(mint).toBuffer(), hash, imageBytes]);
  return { payload, hash, hashHex: hash.toString('hex') };
}

async function signedV1({ legacyInstructions, payerBytes, mintBytes, latest, mint, payload, computeUnitLimit }) {
  const payerSigner = await createKeyPairSignerFromBytes(new Uint8Array(payerBytes));
  const mintSigner = await createKeyPairSignerFromBytes(new Uint8Array(mintBytes));
  const pump = legacyInstructions.filter(ix => ix.programId.toBase58() !== computeBudgetProgram).map(fromLegacyTransactionInstruction);
  const noop = { programAddress: address(noopProgram), accounts: [], data: new Uint8Array(payload) };
  let message = pipe(
    createTransactionMessage({ version: 1 }),
    m => setTransactionMessageFeePayerSigner(payerSigner, m),
    m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: latest.blockhash, lastValidBlockHeight: BigInt(latest.lastValidBlockHeight) }, m),
    m => appendTransactionMessageInstructions([...pump, noop], m),
    m => setTransactionMessageConfig({ computeUnitLimit: computeUnitLimit || 700000, loadedAccountsDataSizeLimit: 64 * 1024 * 1024, priorityFeeLamports: 5000n }, m)
  );
  message = addSignersToTransactionMessage([mintSigner], message);
  const transaction = await signTransactionMessageWithSigners(message);
  assertIsFullySignedTransaction(transaction);
  const size = getTransactionSize(transaction);
  if (size <= atomicV1MaxBytes) assertIsTransactionWithinSizeLimit(transaction);
  const encoded = getBase64EncodedWireTransaction(transaction);
  const wire = Buffer.from(encoded, 'base64');
  if (wire[0] !== 0x81) throw new Error('The constructed transaction is not Solana version 1.');
  const requiredSignatures = wire[1];
  const signerAddresses = Array.from({ length: requiredSignatures }, (_, index) => wire.subarray(42 + index * 32, 74 + index * 32));
  if (!signerAddresses.some(bytes => bytes.equals(new PublicKey(mint).toBuffer()))) throw new Error('The Pump mint is not a required signer of the V1 transaction.');
  return { transaction, encoded, size, signature: getSignatureFromTransaction(transaction) };
}

export async function buildAtomicV1Transaction(args) {
  const committed = await commitmentPayload(args.mint, args.imageBytes);
  const final = await signedV1({ ...args, payload: committed.payload });
  const headerOnly = Buffer.concat([committed.payload.subarray(0, commitmentHeaderBytes)]);
  const base = await signedV1({ ...args, payload: headerOnly });
  return {
    ...final,
    imageSha256: committed.hashHex,
    imageBytes: args.imageBytes.length,
    commitmentBytes: committed.payload.length,
    transactionBytesWithoutImage: base.size,
    remainingBytes: atomicV1MaxBytes - final.size,
    requiredReductionBytes: Math.max(0, final.size - atomicV1MaxBytes)
  };
}