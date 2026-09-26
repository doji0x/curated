import React from 'react';
const sol = value => `${(Number(value || 0) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL`;
export default function BuybackSummary({ data }) {
  const { totals, rewards, state } = data;
  const cards = [['Previously verified vault rewards', totals.accrued], ['Spent on buybacks', totals.swept], ['Historical 20% allocation', totals.retained], ['Wallet above reserve', data.unclaimedSol], ['Unclaimed SOL in creator vaults', data.vaultSol], ['Historical unspent allocation', totals.carry]];
  const late = state.lastRunAt && Date.now() - Date.parse(state.lastRunAt) > 90 * 60 * 1000;
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, value]) => <div key={label} className="rounded-2xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-mono text-xl text-primary">{sol(value)}</p></div>)}</div>
    <section className="mt-5 space-y-3 rounded-2xl border border-border bg-card p-5 text-sm">
      <p><span className="text-primary">{state.enabled ? 'Buybacks enabled' : 'Buybacks paused'}</span> · Hourly schedule · 0.01 SOL minimum · 1% minimum-output tolerance</p>
      <p className="text-muted-foreground">Last worker run: {state.lastRunAt ? new Date(state.lastRunAt).toLocaleString() : 'Waiting for the first scheduled run'}{late ? ' — overdue; check the workflow before relying on the schedule.' : ''}</p>
      {state.lastOutcome && <p>{state.lastOutcome}</p>}{state.lastError && <p className="text-destructive">{state.lastError}</p>}
      <p className="break-all font-mono text-xs text-muted-foreground">Creator / buyback wallet: {data.wallet}</p>
      <p className="text-xs leading-5 text-muted-foreground">Claim SOL rewards collects SOL from this wallet’s creator vaults into the wallet without buying Burn. Scheduled buys use 80% of the wallet balance above the operating reserve, leaving room for transaction costs. The wallet balance may include other deposits, which cannot be distinguished from claimed rewards. Purchased Burn stays in this wallet.</p>
    </section>
    {rewards.some(row => row.mint !== data.solMint && BigInt(row.total) > 0n) && <section className="mt-5 rounded-2xl border border-primary/30 bg-card p-5"><h2 className="font-semibold">Other reward assets · awaiting conversion</h2>{rewards.filter(row => row.mint !== data.solMint && BigInt(row.total) > 0n).map(row => <div key={row.mint} className="mt-3 break-all font-mono text-xs text-muted-foreground">{row.mint}<p className="mt-1">{row.total} base units remain in the reward vaults, untouched.</p></div>)}</section>}
  </>;
}