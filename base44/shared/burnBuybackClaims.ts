import { PublicKey } from 'npm:@solana/web3.js@1.98.4';
import { inspectBurnEscrow, prepareEscrowInstructions, claimLookupTable } from './burnEscrowClaim.ts';
import { prepareCreatorClaim } from './creatorClaims.ts';
import { claimAssert } from './creatorClaimsCore.js';

export async function quoteSolRewards(ctx) {
  return (await inspectBurnEscrow(ctx)).claim;
}

export async function solClaimInstructions(ctx) {
  return prepareEscrowInstructions(ctx);
}

export async function prepareSolClaim(ctx) {
  const prepared = await solClaimInstructions(ctx);
  if (prepared.skipped) return prepared;
  const { value: table } = await ctx.connection.getAddressLookupTable(new PublicKey(claimLookupTable));
  claimAssert(table?.isActive(), 'The verified claim lookup table is unavailable. No transaction was sent.');
  return prepareCreatorClaim({ ...ctx, claimLookupTable: table }, prepared, 'manual claim');
}