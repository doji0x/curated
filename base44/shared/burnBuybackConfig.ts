export const burnMint = '6ZdCWrLhmBJmoLCL8reNCBxqJGBxXgQyM2PcDo4kpump';
export const solMint = 'So11111111111111111111111111111111111111112';
export const minimumBuy = 10_000_000n;
export const gasReserve = 30_000_000n;
export const allocation = amount => BigInt(amount) * 8000n / 10000n;
export const stateKey = 'burn-v1';
export async function getBuybackState(db) {
  const rows = await db.BurnBuybackState.filter({ key: stateKey }, 'created_date', 2);
  if (rows.length !== 1) throw new Error('Buyback control must have exactly one initialized record. No funds were moved.');
  return rows[0];
}
export async function buybackTotals(db, wallet) {
  let accrued = 0n, swept = 0n, coins = 0n, fees = 0n, rewardSpent = 0n;
  for (let skip = 0; ; skip += 100) {
    const rows = await db.BuybackRecord.filter({ wallet, status: 'confirmed' }, 'created_date', 100, skip);
    for (const row of rows) {
      accrued += BigInt(row.totalAccrued || '0');
      const spent = BigInt(row.sweptAmount || '0');
      const available = allocation(accrued) > rewardSpent ? allocation(accrued) - rewardSpent : 0n;
      // A discretionary wallet buy consumes existing reward carry first, but
      // never pre-spends future rewards that have not yet been collected.
      rewardSpent += row.source === 'manual buy' ? (spent < available ? spent : available) : spent;
      swept += spent; coins += BigInt(row.coinsReceived || '0'); fees += BigInt(row.networkFee || '0');
    }
    if (rows.length < 100) break;
  }
  const allocated = allocation(accrued);
  return { accrued: String(accrued), swept: String(swept), coins: String(coins), fees: String(fees), retained: String(accrued - allocated), carry: String(allocated > rewardSpent ? allocated - rewardSpent : 0n) };
}