import { getBuybackState } from './burnBuybackConfig.ts';
import { settleBuyback } from './burnBuybackSettlement.ts';
import { acquireBuybackLock, releaseBuybackLock } from './burnBuybackLock.ts';
import { prepareCreatorClaim } from './creatorClaims.ts';
import { createClaimRunner } from './creatorClaimRun.js';

export const runBuyback = createClaimRunner({ getBuybackState, settleBuyback, acquireBuybackLock, releaseBuybackLock, prepareCreatorClaim });
