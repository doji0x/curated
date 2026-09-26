import * as sdk from 'npm:@pump-fun/pump-sdk@2.0.0';
import * as spl from 'npm:@solana/spl-token@0.4.15';
import * as web3 from 'npm:@solana/web3.js@1.99.0';
import BN from 'npm:bn.js@5.2.5';
import { createTreasuryTools } from './treasuryLaunchCore.js';
export const treasuryLaunch = createTreasuryTools({ sdk, spl, web3, BN });
