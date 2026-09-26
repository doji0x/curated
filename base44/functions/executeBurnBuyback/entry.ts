import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { secrets } from 'base44:runtime';
import { Connection, Keypair } from 'npm:@solana/web3.js@1.98.4';
import { OnlinePumpSdk } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { parseWallet, assertMainnet, adminWalletSecretName } from '../../shared/mintWallet.ts';
import { burnMint, solMint, gasReserve, minimumBuy, getBuybackState, buybackTotals } from '../../shared/burnBuybackConfig.ts';
import { reconcileBuybackStatus } from '../../shared/burnBuybackLock.ts';
import { runBuyback } from '../../shared/burnBuybackRun.ts';
import { claimTools } from '../../shared/creatorClaims.ts';
import { assertClaimWallet, PURCHASES_PAUSED } from '../../shared/creatorClaimsCore.js';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user || user.role !== 'admin') return Response.json({ error: 'Admin access required.' }, { status: 403 });
    if (req.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 });
    const text = await req.text();
    if (text.length > 1000) return Response.json({ error: 'Request too large.' }, { status: 413 });
    const body = text ? JSON.parse(text) : {};
    const action = body.action || 'status';
    if (!['status', 'run', 'preview', 'setEnabled', 'claim', 'buy'].includes(action)) return Response.json({ error: 'Invalid action.' }, { status: 400 });
    if (action === 'buy' || action === 'preview' || (action === 'setEnabled' && body.enabled === true)) return Response.json({ error: PURCHASES_PAUSED }, { status: 409 });
    const db = base44.asServiceRole.entities;
    const state = await getBuybackState(db);
    if (action === 'setEnabled') {
      if (typeof body.enabled !== 'boolean') return Response.json({ error: 'Choose enabled or paused.' }, { status: 400 });
      await db.BurnBuybackState.update(state.id, { enabled: body.enabled });
      return Response.json({ enabled: body.enabled });
    }
    const rpcUrl = secrets.get('SOLANA_RPC_URL');
    await assertMainnet(rpcUrl);
    const wallet = Keypair.fromSecretKey(parseWallet(secrets.get(adminWalletSecretName), adminWalletSecretName));
    assertClaimWallet(wallet.publicKey);
    const connection = new Connection(rpcUrl, { commitment: 'confirmed', fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) });
    const online = new OnlinePumpSdk(connection);
    const ctx = { base44, db, rpcUrl, wallet, connection, online };
    if (action === 'run') {
      await reconcileBuybackStatus(ctx);
      return Response.json({ skipped: true, reason: PURCHASES_PAUSED });
    }
    if (action === 'claim') return Response.json(await runBuyback(ctx, action));
    if (action === 'status') await reconcileBuybackStatus(ctx);
    const totals = await buybackTotals(db, wallet.publicKey.toBase58());
    const offset = body.offset === undefined ? 0 : body.offset;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return Response.json({ error: 'Invalid page.' }, { status: 400 });
    const [rows, balance, latestState, pending] = await Promise.all([db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58() }, '-created_date', 20, offset), connection.getBalance(wallet.publicKey, 'confirmed'), getBuybackState(db), db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58(), status: 'pending' }, 'created_date', 1)]);
    const records = rows.map(({ signedTransaction, ...row }) => row);
    const available = BigInt(balance) - gasReserve;
    let claim = null, claimError = '';
    try { claim = await claimTools.inspect(connection, wallet.publicKey); }
    catch (error) { claimError = error.message || 'Unable to read creator reward vaults.'; }
    return Response.json({ burnMint, solMint, wallet: wallet.publicKey.toBase58(), signerVerified: true, purchasesPaused: true,
      state: { enabled: false, configuredEnabled: latestState.enabled, locked: Date.parse(latestState.lockUntil) > Date.now(), lastRunAt: latestState.lastRunAt, lastOutcome: latestState.lastOutcome, lastError: latestState.lastError },
      walletBalance: String(balance), availableSol: String(available > 0n ? available : 0n), gasReserve: String(gasReserve), minimumBuy: String(minimumBuy),
      hasPending: pending.length > 0, totals, unclaimedSol: claim?.estimatedClaim ?? null, claim, claimError, rewards: [], records });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to process creator rewards.' }, { status: error.status || 500 });
  }
}
