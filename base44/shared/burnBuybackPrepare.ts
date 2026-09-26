import { PURCHASES_PAUSED } from './creatorClaimsCore.js';

// Retired wallet-balance sweep. Purchases must pass through the reward ledger.
export async function prepareBuyback() {
  throw new Error(PURCHASES_PAUSED);
}
