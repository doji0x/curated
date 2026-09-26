import React from 'react';
const sol = value => value === null ? 'Unavailable' : `${(Number(value || 0) / 1e9).toLocaleString(undefined, { maximumFractionDigits: 9 })} SOL`;

export default function BuybackSummary({ data }) {
  const { totals, state, claim } = data;
  const cards = [['Treasury wallet balance', data.walletBalance], ['Unclaimed rewards · estimate', data.unclaimedSol], ['Verified claims · current flow', totals.claimed], ['Burn-specific claims', totals.mintClaimed], ['Pooled creator-wallet claims', totals.pooledClaimed], ['Claim network fees', totals.claimFees]];
  return <>
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{cards.map(([label, value]) => <div key={label} className="rounded-2xl border border-border bg-card p-5"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 font-mono text-xl text-primary">{sol(value)}</p></div>)}</div>
    <section className="mt-5 space-y-3 rounded-2xl border border-border bg-card p-5 text-sm">
      <p className="text-primary">Claim-only phase · purchases paused</p>
      <p className="break-all font-mono text-xs text-muted-foreground">Verified treasury: {data.wallet}</p>
      {claim && <><p className="text-muted-foreground">{claim.notice}</p><p className="text-xs text-muted-foreground">{claim.route === 'sharing' ? 'Fee-sharing distribution' : 'Direct creator-vault collection'} · {claim.graduated ? 'PumpSwap pool available' : 'Bonding curve'} · Treasury share: {claim.shareBps / 100}%</p></>}
      {data.claimError && <p role="alert" className="text-destructive">Reward lookup failed: {data.claimError}</p>}
      {state.lastOutcome && <p>{state.lastOutcome}</p>}{state.lastError && <p className="text-destructive">{state.lastError}</p>}
      <p className="text-xs leading-5 text-muted-foreground">Claims remain in the treasury. Future allocations will use each coin’s verified receipts: 80% to buy and burn that coin and 20% retained. Existing deposits and pooled rewards are not automatically attributed to Burn. Historical purchases remain visible below.</p>
    </section>
  </>;
}
