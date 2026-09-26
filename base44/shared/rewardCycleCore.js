import { CLAIM_MINT, CLAIM_WALLET, claimAssert } from './creatorClaimsCore.js';

export const CYCLE_VERSION = 1;
export const REWARD_BPS = 8000n;
export const amount = value => {
  claimAssert(typeof value === 'string' && /^\d+$/.test(value), 'Invalid exact reward amount.');
  return BigInt(value);
};

// No wallet balance is accepted by this function. Only finalized receipts fund buys.
export function rewardLedger(rows, startedAt) {
  let claimed = 0n, allocated = 0n, spent = 0n, burned = 0n, fees = 0n, rent = 0n;
  const signatures = new Set(), claimSignatures = [];
  if (!startedAt) return { claimed: '0', allocated: '0', retained: '0', spent: '0', available: '0', protected: '0', burned: '0', fees: '0', rent: '0', claimSignatures };
  claimAssert(Number.isFinite(Date.parse(startedAt)), 'Invalid reward accounting start.');
  for (const row of rows) {
    if (row.wallet !== CLAIM_WALLET || row.status !== 'confirmed') continue;
    claimAssert(Number.isFinite(Date.parse(row.createdAt)), 'Receipt has no valid creation timestamp.');
    if (Date.parse(row.createdAt) < Date.parse(startedAt)) continue;
    if (!(row.claimVersion === 1 || row.cycleVersion === CYCLE_VERSION)) continue;
    claimAssert(row.signature && !signatures.has(row.signature), 'Duplicate receipt signature; reconcile before spending.');
    signatures.add(row.signature);
    if (row.claimVersion === 1) {
      if (row.claimScope !== 'mint' || row.attributedMint !== CLAIM_MINT || row.quoteMint !== 'So11111111111111111111111111111111111111112') continue;
      const received = amount(row.totalAccrued);
      claimed += received; allocated += received * REWARD_BPS / 10000n;
      claimSignatures.push(row.signature);
    } else {
      claimAssert(row.buyMint === CLAIM_MINT && row.epoch === startedAt, 'Cycle receipt belongs to another mint or accounting epoch.');
      if (row.cycleStep === 'buy') spent += amount(row.sweptAmount);
      if (row.cycleStep === 'burn') burned += amount(row.burnedAmount);
      if (row.cycleStep === 'close') rent += amount(row.rentRefund);
    }
    fees += amount(row.networkFee || '0');
  }
  claimAssert(spent <= allocated, 'Purchase receipts exceed the verified reward allocation.');
  return { claimed: String(claimed), allocated: String(allocated), retained: String(claimed - allocated), spent: String(spent),
    available: String(allocated - spent), protected: String(claimed - spent), burned: String(burned), fees: String(fees), rent: String(rent), claimSignatures };
}

export function assertRewardBudget(budget, ledger) {
  const value = amount(budget);
  claimAssert(value > 0n && value <= amount(ledger.available), 'Buy budget exceeds the unspent, verified reward balance.');
  return value;
}

export async function allWalletRecords(db) {
  const rows = [];
  for (let skip = 0; ; skip += 100) {
    const page = await db.BuybackRecord.filter({ wallet: CLAIM_WALLET }, 'created_date', 100, skip);
    rows.push(...page);
    if (page.length < 100) return rows;
  }
}

export function cycleReceipt(meta, keys, plan, quoteTransfers = []) {
  claimAssert(meta && !meta.err && Number.isSafeInteger(meta.fee), 'Missing successful finalized transaction metadata.');
  const tokenIndex = keys.indexOf(plan.tokenAccount);
  const token = (balances, required) => {
    const row = balances?.find(x => x.accountIndex === tokenIndex);
    claimAssert(!required || row, 'Missing Burn token account in receipt.');
    if (!row) return 0n;
    claimAssert(row.mint === CLAIM_MINT && row.owner === CLAIM_WALLET && row.uiTokenAmount.decimals === plan.decimals, 'Unexpected token receipt.');
    return amount(row.uiTokenAmount.amount);
  };
  const pre = token(meta.preTokenBalances, plan.step !== 'buy'), post = token(meta.postTokenBalances, plan.step !== 'close');
  const common = { networkFee: String(meta.fee), totalAccrued: '0', sweptAmount: '0', coinsReceived: '0', burnedAmount: '0', rentRefund: '0' };
  if (plan.step === 'buy') {
    const received = post - pre;
    const spent = quoteTransfers.reduce((sum, row) => sum + amount(row), 0n);
    claimAssert(received > 0n && received >= amount(plan.minimumOut) && spent > 0n && spent <= amount(plan.budget), 'Purchase receipt does not match its reward budget or minimum output.');
    return { ...common, coinsReceived: String(received), sweptAmount: String(spent), tokenDecimals: plan.decimals };
  }
  if (plan.step === 'burn') {
    claimAssert(pre - post === amount(plan.burnAmount), 'Burn receipt does not destroy exactly the purchased tokens.');
    return { ...common, burnedAmount: plan.burnAmount, tokenDecimals: plan.decimals };
  }
  claimAssert(plan.step === 'close' && tokenIndex >= 0 && pre === 0n && post === 0n && meta.postBalances[tokenIndex] === 0, 'Cleanup did not close an empty token account.');
  const payer = keys.indexOf(CLAIM_WALLET);
  claimAssert(Number.isSafeInteger(meta.preBalances[tokenIndex]) && payer >= 0, 'Missing rent receipt.');
  const refund = BigInt(meta.preBalances[tokenIndex]);
  claimAssert(BigInt(meta.postBalances[payer]) - BigInt(meta.preBalances[payer]) + BigInt(meta.fee) === refund, 'Rent refund did not reach the treasury.');
  return { ...common, rentRefund: String(refund) };
}
