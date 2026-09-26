import { createRewardCycleRunner } from './rewardCycleRunner.js';
import { getBuybackState } from './burnBuybackConfig.ts';
import { acquireBuybackLock, releaseBuybackLock } from './burnBuybackLock.ts';
import { prepareCreatorClaim, claimTools } from './creatorClaims.ts';
import { prepareCycleStep } from './rewardCycleChain.ts';
import { settleBuyback } from './burnBuybackSettlement.ts';
import { allWalletRecords, rewardLedger } from './rewardCycleCore.js';

export const runRewardCycle = createRewardCycleRunner({ getBuybackState, acquireBuybackLock, releaseBuybackLock, prepareCreatorClaim,
  inspectClaim: ctx => claimTools.inspect(ctx.connection, ctx.wallet.publicKey), prepareCycleStep, settleBuyback });
export async function rewardCycleStatus(db, state) {
  const ledger = rewardLedger(await allWalletRecords(db), state.rewardStartedAt);
  const cycles = await db.BurnRewardCycle.filter({ wallet: state.wallet || '3ggRizSixiDPXyHrEzBaZ3Nm8QfFRD1FbrkkYYpxMxkq' }, '-created_date', 10);
  return { ...ledger, enabled: state.automationEnabled === true, startedAt: state.rewardStartedAt || null, intervalMinutes: 5,
    nextRunAt: new Date(Math.ceil((Date.now() + 1) / 300000) * 300000).toISOString(), cycles };
}
