import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { secrets } from 'base44:runtime';
import { Connection, Keypair } from 'npm:@solana/web3.js@1.98.4';
import { OnlinePumpSdk } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { parseWallet, assertMainnet, adminWalletSecretName } from '../../shared/mintWallet.ts';
import { assertClaimWallet } from '../../shared/creatorClaimsCore.js';
import { authorizeRewardWorker } from '../../shared/rewardCycleAuth.js';
import { runRewardCycle } from '../../shared/rewardCycle.ts';

export default async function(req: Request): Promise<Response> {
  try {
    if (req.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 });
    const base44 = createClientFromRequest(req);
    if (!await authorizeRewardWorker(base44)) return Response.json({ error: 'Authorized workflow or admin access required.' }, { status: 403 });
    const rpcUrl = secrets.get('SOLANA_RPC_URL');
    await assertMainnet(rpcUrl);
    const wallet = Keypair.fromSecretKey(parseWallet(secrets.get(adminWalletSecretName), adminWalletSecretName));
    assertClaimWallet(wallet.publicKey);
    const connection = new Connection(rpcUrl, { commitment: 'confirmed', fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) });
    return Response.json(await runRewardCycle({ base44, db: base44.asServiceRole.entities, rpcUrl, wallet, connection, online: new OnlinePumpSdk(connection) }));
  } catch (error) { return Response.json({ error: error.message || 'Reward cycle failed.' }, { status: error.status || 500 }); }
}
