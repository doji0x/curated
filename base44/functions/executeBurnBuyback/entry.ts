import { createClientFromRequest } from 'npm:@base44/sdk@0.8.49';
import { secrets } from 'base44:runtime';
import { Connection, Keypair } from 'npm:@solana/web3.js@1.98.4';
import { OnlinePumpSdk } from 'npm:@pump-fun/pump-sdk@2.0.0';
import { parseWallet, assertMainnet } from '../../shared/mintWallet.ts';
import { burnMint, solMint, getBuybackState, buybackTotals } from '../../shared/burnBuybackConfig.ts';
import { runBuyback } from '../../shared/burnBuybackRun.ts';
import { prepareBuyback } from '../../shared/burnBuybackPrepare.ts';

export default async function(req: Request): Promise<Response> {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Admin access required.' }, { status: 403 });
    if (req.method !== 'POST') return Response.json({ error: 'Use POST.' }, { status: 405 });
    const text = await req.text();
    if (text.length > 1000) return Response.json({ error: 'Request too large.' }, { status: 413 });
    const body = text ? JSON.parse(text) : {};
    const action = body.action || 'status';
    if (!['status', 'run', 'preview', 'setEnabled'].includes(action)) return Response.json({ error: 'Invalid action.' }, { status: 400 });
    const db = base44.asServiceRole.entities;
    const state = await getBuybackState(db);
    if (action === 'setEnabled') {
      if (typeof body.enabled !== 'boolean') return Response.json({ error: 'Choose enabled or paused.' }, { status: 400 });
      await db.BurnBuybackState.update(state.id, { enabled: body.enabled });
      return Response.json({ enabled: body.enabled });
    }
    const rpcUrl = secrets.get('SOLANA_RPC_URL');
    await assertMainnet(rpcUrl);
    const wallet = Keypair.fromSecretKey(parseWallet(secrets.get('MINT_WALLET_SECRET_KEY')));
    const connection = new Connection(rpcUrl, { commitment: 'confirmed', fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(20000) }) });
    const online = new OnlinePumpSdk(connection);
    const ctx = { base44, db, rpcUrl, wallet, connection, online };
    if (action === 'run') return Response.json(await runBuyback(ctx));
    const totals = await buybackTotals(db, wallet.publicKey.toBase58());
    if (action === 'preview') return Response.json(await prepareBuyback(ctx, totals, true));
    const offset = body.offset === undefined ? 0 : body.offset;
    if (!Number.isInteger(offset) || offset < 0 || offset > 100000) return Response.json({ error: 'Invalid page.' }, { status: 400 });
    const [balances, rows] = await Promise.all([online.getCreatorVaultQuoteBalances(wallet.publicKey), db.BuybackRecord.filter({ wallet: wallet.publicKey.toBase58() }, '-created_date', 20, offset)]);
    const rewards = balances.map(row => ({ mint: row.mint.toBase58(), pumpVault: row.pumpVault.toString(), ammVault: row.ammVault.toString(), total: row.total.toString() }));
    const records = rows.map(({ signedTransaction, ...row }) => row);
    return Response.json({ burnMint, solMint, wallet: wallet.publicKey.toBase58(), state: { enabled: state.enabled, lastRunAt: state.lastRunAt, lastOutcome: state.lastOutcome, lastError: state.lastError }, totals, unclaimedSol: rewards.find(row => row.mint === solMint)?.total || '0', rewards, records });
  } catch (error) {
    return Response.json({ error: error.message || 'Unable to process buybacks.' }, { status: 500 });
  }
}