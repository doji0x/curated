import BN from 'npm:bn.js@5.2.2';
import { Connection } from 'npm:@solana/web3.js@1.98.4';
import { OnlinePumpSdk, PUMP_SDK, getBuyTokenAmountFromSolAmount } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { resolveSupportedPair, supportedPairOptions } from './pumpPairs.ts';
import { atomicAmount } from './pumpBuy.ts';

export const defaultV1Quote = 'So11111111111111111111111111111111111111112';
export async function atomicV1RewardOptions(rpcUrl) {
  const online = new OnlinePumpSdk(new Connection(rpcUrl, 'confirmed'));
  const [global, pairs] = await Promise.all([online.fetchGlobal(), supportedPairOptions(online)]);
  return { pairs, holderRewardEnabled: global.isHolderRewardEnabled, creatorFeeConfigurable: global.creatorFeeConfigurable, maxCreatorFeeBps: Number(global.maxConfigurableCreatorFeeBps?.toString() || 0) };
}
export async function atomicV1PumpInstructions({ rpcUrl, mintKey, input, metadataUri, creator, payer }) {
  const online = new OnlinePumpSdk(new Connection(rpcUrl, 'confirmed'));
  const [global, { quote }] = await Promise.all([online.fetchGlobal(), resolveSupportedPair(online, input.quoteMint || defaultV1Quote)]);
  const bps = input.creatorFeeBps || 0;
  if (!Number.isInteger(bps) || bps < 0 || bps > Number(global.maxConfigurableCreatorFeeBps.toString()) || (bps > 0 && !global.creatorFeeConfigurable)) throw new Error('Creator fee is outside Pump’s current allowed range.');
  if (input.holderReward && !global.isHolderRewardEnabled) throw new Error('Pump currently has holder rewards disabled.');
  const creatorFeeBps = bps ? new BN(bps) : undefined;
  const shared = { global, mint: mintKey, name: input.name, symbol: input.symbol, uri: metadataUri, creator, user: payer, mayhemMode: false, holderReward: Boolean(input.holderReward), creatorFeeBps, quoteMint: quote.mint, quoteTokenProgram: quote.quoteTokenProgram };
  if (!input.firstBuyAmount) return [await PUMP_SDK.createV2Instruction(shared)];
  const quoteAmount = atomicAmount(input.firstBuyAmount, quote.decimals);
  const [feeConfig, quoteControl] = await Promise.all([online.fetchFeeConfig(), online.fetchQuoteControl()]);
  const amount = getBuyTokenAmountFromSolAmount({ global, feeConfig, mintSupply: null, bondingCurve: null, amount: quoteAmount, quoteMint: quote.mint, quoteControl, creatorFeeBps });
  return PUMP_SDK.createV2AndBuyV2Instructions({ ...shared, amount, quoteAmount });
}