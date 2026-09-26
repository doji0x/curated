import { Buffer } from 'node:buffer';
import BN from 'npm:bn.js@5.2.2';
import { PublicKey } from 'npm:@solana/web3.js@1.98.4';
import { PUMP_SDK, PUMP_PROGRAM_ID, PUMP_AMM_PROGRAM_ID, getPumpProgram, getPumpAmmProgram, getBuyTokenAmountFromSolAmount, canonicalPumpPoolPda, bondingCurvePda } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { OnlinePumpAmmSdk, PUMP_AMM_SDK } from 'npm:@pump-fun/pump-swap-sdk@1.13.0';
import { burnMint, solMint } from './burnBuybackConfig.ts';

// Use the published IDL to verify account compatibility before changing an
// SDK exact-output builder to the program's exact-budget variant.
function exactBudget(instructions, program, programId, originalName, exactName, budget, minimumField) {
  const normalize = value => value.replace(/_/g, '').toLowerCase();
  const original = program.idl.instructions.find(ix => normalize(ix.name) === normalize(originalName));
  const exact = program.idl.instructions.find(ix => normalize(ix.name) === normalize(exactName));
  if (!original || !exact || JSON.stringify(original.accounts.map(a => normalize(a.name))) !== JSON.stringify(exact.accounts.map(a => normalize(a.name)))) throw new Error('Exact-budget account layout changed; buyback halted.');
  let changed = false;
  for (const ix of instructions) {
    if (!ix.programId.equals(programId) || !Buffer.from(ix.data.subarray(0, 8)).equals(Buffer.from(original.discriminator))) continue;
    const decoded = program.coder.instruction.decode(ix.data);
    const expected = new BN(ix.data.subarray(8, 16), 'le');
    const min = expected.muln(90).divn(100);
    if (min.isZero()) throw new Error('Expected token output is too small.');
    ix.data = program.coder.instruction.encode(exact.name, { ...decoded.data, spendableQuoteIn: budget, [minimumField]: min });
    changed = true;
  }
  if (!changed) throw new Error('Could not identify the purchase instruction.');
  return instructions;
}
export async function burnTrade(ctx, lamports) {
  const { connection, online, wallet } = ctx;
  const mint = new PublicKey(burnMint), user = wallet.publicKey;
  const info = await connection.getAccountInfo(mint, 'confirmed');
  if (!info || !['TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'].includes(info.owner.toBase58())) throw new Error('The Burn address is not a token mint.');
  const budget = new BN(String(lamports));
  const curveInfo = await connection.getAccountInfo(bondingCurvePda(mint), 'confirmed');
  const curve = curveInfo ? PUMP_SDK.decodeBondingCurve(curveInfo) : null;
  if (curve && !curve.complete) {
    const state = await online.fetchBuyState(mint, user, info.owner);
    if (state.quoteMint.toBase58() !== solMint) throw new Error('Burn is not SOL-paired; quote-asset conversion is required before buying.');
    const [global, feeConfig, quoteControl] = await Promise.all([online.fetchGlobal(), online.fetchFeeConfig(), online.fetchQuoteControl()]);
    const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, quoteControl, bondingCurve: state.bondingCurve, mintSupply: state.bondingCurve.tokenTotalSupply, amount: budget, quoteMint: state.quoteMint, creatorFeeBps: state.bondingCurve.creatorFeeBps });
    const instructions = await PUMP_SDK.buyV2Instructions({ global, ...state, mint, user, amount, quoteAmount: budget, slippage: 0, tokenProgram: info.owner });
    return exactBudget(instructions, getPumpProgram(connection), PUMP_PROGRAM_ID, 'buyV2', 'buyExactQuoteInV2', budget, 'minTokensOut');
  }
  const amm = new OnlinePumpAmmSdk(connection);
  const state = await amm.swapSolanaState(canonicalPumpPoolPda(mint), user);
  if (state.pool.baseMint.toBase58() !== burnMint || state.pool.quoteMint.toBase58() !== solMint) throw new Error('No supported SOL-paired Burn pool was found.');
  const instructions = await PUMP_AMM_SDK.buyQuoteInput(state, budget, 0);
  return exactBudget(instructions, getPumpAmmProgram(connection), PUMP_AMM_PROGRAM_ID, 'buy', 'buyExactQuoteIn', budget, 'minBaseAmountOut');
}