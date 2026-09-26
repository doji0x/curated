import { PURCHASES_PAUSED } from './creatorClaimsCore.js';

// Retired discretionary wallet purchase path. There is no manual amount override.
export async function prepareManualBuyback() {
  throw new Error(PURCHASES_PAUSED);
}
