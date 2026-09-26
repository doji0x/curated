import React from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Clock3, XCircle } from 'lucide-react';

export default function PublicLaunchResult({ result }) {
  if (!result) return null;
  const confirmed = result.status === 'confirmed', failed = result.status === 'failed';
  const Icon = confirmed ? CheckCircle2 : failed ? XCircle : Clock3;
  return <section aria-live="polite" className="mt-6 rounded-2xl border border-border bg-card p-5 text-left">
    <div className="flex gap-3"><Icon className={confirmed ? 'text-primary' : failed ? 'text-destructive' : 'text-primary'} /><div><h2 className="font-semibold">{confirmed ? 'Coin launched' : failed ? 'Launch failed on-chain' : 'Launch submitted'}</h2><p className="mt-1 text-sm text-muted-foreground">{confirmed ? 'Your coin is live on pump.fun.' : failed ? 'No launch was completed.' : 'The signed launch is awaiting confirmation. Use Check status to review it.'}</p></div></div>
    {confirmed && result.inscribedMint && <Link to={`/edit-coin?coin=${encodeURIComponent(result.coinMint)}`} className="mt-4 inline-block text-sm text-primary underline underline-offset-4">Update name, image & links</Link>}
    {confirmed && !result.inscribedMint && <p className="mt-3 text-xs text-muted-foreground">This coin uses the uploaded static metadata file. Its display metadata cannot be updated through Burn.</p>}
    {result.quoteSymbol && <p className="mt-3 text-sm text-muted-foreground">Pair asset: {result.quoteSymbol} · First buy: {result.firstBuyAmount} {result.quoteSymbol}</p>}
    {result.rewardStatus && <p className={`mt-3 text-xs ${result.rewardStatus === 'failed' ? 'text-destructive' : 'text-muted-foreground'}`}>{result.rewardStatus === 'confirmed' ? 'Custom reward sharing is configured.' : result.rewardStatus === 'failed' ? result.rewardError : 'Configuring custom reward sharing in a separate transaction…'}</p>}
    <div className="mt-4 space-y-2 font-mono text-[10px]">{result.signature && <a className="block break-all text-launch-brand underline" href={`https://solscan.io/tx/${result.signature}`} target="_blank" rel="noreferrer">Transaction: {result.signature}</a>}{result.rewardSignature && <a className="block break-all text-launch-brand underline" href={`https://solscan.io/tx/${result.rewardSignature}`} target="_blank" rel="noreferrer">Rewards: {result.rewardSignature}</a>}<a className="block break-all text-launch-brand underline" href={`https://pump.fun/coin/${result.coinMint}`} target="_blank" rel="noreferrer">Coin: {result.coinMint}</a></div>
  </section>;
}