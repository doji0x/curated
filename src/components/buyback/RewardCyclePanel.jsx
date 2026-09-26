import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { buttonVariants } from '@/components/ui/button';
import { formatClaimSol } from './claimUiState';

export default function RewardCyclePanel({ data, refreshing, statusError }) {
  const client = useQueryClient();
  const automation = data.automation;
  const toggle = useMutation({
    mutationFn: async (/** @type {boolean} */ enabled) => {
      const result = (await base44.functions.invoke('executeBurnBuyback', { action: 'setAutomation', enabled })).data;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['burn-buybacks'] }),
    retry: false,
  });
  if (!automation) return null;
  const stats = [['Eligible rewards claimed', automation.claimed], ['80% allocated', automation.allocated], ['Verified reward balance left to spend', automation.available],
    ['Actual purchases', automation.spent], ['20% retained', automation.retained], ['Recovered rent · operating funds', automation.rent]];
  return <section className="mt-5 rounded-2xl border border-primary/30 bg-card p-5" aria-labelledby="reward-cycle-heading">
    <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="reward-cycle-heading" className="font-heading font-semibold">Automated claim, buy and burn</h2>
      <button type="button" className={buttonVariants({ variant: 'outline' })} disabled={toggle.isPending || refreshing || statusError || data.rewardCycleVersion !== 1} onClick={() => toggle.mutate(!automation.enabled)}>{toggle.isPending ? 'Saving…' : automation.enabled ? 'Pause automation' : 'Enable every 5 minutes'}</button></div>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">{automation.enabled ? 'Enabled' : 'Paused'} · 1% slippage limit · 0.03 SOL operating reserve, funded separately. Purchases are limited to the unspent 80% of finalized Burn reward receipts. Wallet deposits never add to this budget.</p>
    <p className="mt-2 text-xs text-muted-foreground">{automation.startedAt ? `Accounting started ${new Date(automation.startedAt).toLocaleString()}.` : 'The first activation starts a new ledger; existing wallet funds and older claims are excluded.'} {automation.enabled && `Next scheduled check: ${new Date(automation.nextRunAt).toLocaleTimeString()}.`} Pausing stops new submissions; already submitted transactions can still finalize.</p>
    <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{stats.map(([label, value]) => <div key={label}><p className="text-xs text-muted-foreground">{label}</p><p className="font-mono text-sm text-primary">{formatClaimSol(value)}</p></div>)}</div>
    {toggle.error && <p role="alert" className="mt-3 text-destructive">{toggle.error.message}</p>}
    <div className="mt-5 space-y-3">{automation.cycles.map(cycle => <div key={cycle.id} className="rounded-xl border border-border p-3 text-xs">
      <p className="font-semibold">{cycle.status === 'completed' ? 'Completed' : `Awaiting ${cycle.status}`} · {new Date(cycle.createdAt).toLocaleString()}</p>
      <p className="mt-1">Budget: {formatClaimSol(cycle.budget)} · Spent: {formatClaimSol(cycle.spent || '0')}</p>
      <p className="mt-1 font-mono">Tokens bought: {cycle.tokensBought || '0'} base units · Burned: {cycle.tokensBurned || '0'} base units</p>
      <div className="mt-2 flex gap-3">{[['Buy', cycle.buySignature], ['Burn', cycle.burnSignature], ['Rent recovery', cycle.closeSignature]].filter(([, signature]) => signature).map(([label, signature]) => <a key={label} className="text-primary underline" target="_blank" rel="noreferrer" href={`https://solscan.io/tx/${signature}`}>{label}</a>)}</div>
      {cycle.cleanupNote && <p className="mt-2 text-muted-foreground">{cycle.cleanupNote}</p>}{cycle.lastError && <p role="alert" className="mt-2 text-destructive">{cycle.lastError}</p>}
    </div>)}</div>
  </section>;
}
