import React, { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { claimUiState, formatClaimSol } from './claimUiState';

export default function ManualBuybackActions({ data, signature, onSubmitted, onRefresh, refreshing, statusError, updatedAt }) {
  const client = useQueryClient();
  const inFlight = useRef(false);
  const [errorAt, setErrorAt] = useState(0);
  const mutation = useMutation({
    mutationFn: async (/** @type {{ action: string, signature?: string }} */ payload) => {
      const result = (await base44.functions.invoke('executeBurnBuyback', payload)).data;
      if (result?.error) throw new Error(result.error);
      return result;
    },
    retry: false,
    onMutate: () => client.cancelQueries({ queryKey: ['burn-buybacks'] }),
    onSuccess: result => {
      const nextSignature = result.record?.signature || result.signature;
      if (nextSignature) onSubmitted(nextSignature);
    },
    onError: () => setErrorAt(Date.now()),
    onSettled: () => client.invalidateQueries({ queryKey: ['burn-buybacks'] }),
  });
  const ui = claimUiState({ data, result: mutation.data, signature,
    submitting: mutation.isPending, recovering: mutation.variables?.action === 'recover',
    refreshing, statusError, needsRefresh: mutation.isError && updatedAt <= errorAt });
  const error = mutation.error?.response?.data?.error || mutation.error?.message;
  async function submit(action) {
    if (inFlight.current || (action === 'claim' ? !ui.canClaim : !ui.canRecover)) return;
    inFlight.current = true;
    try { await mutation.mutateAsync(action === 'recover' ? { action, signature: ui.signature } : { action }); }
    catch { /* Render the error and refresh control. Never retry automatically. */ }
    finally { inFlight.current = false; }
  }
  return <section className="mt-5 rounded-2xl border border-border bg-card p-5" aria-labelledby="claim-heading" aria-busy={mutation.isPending}>
    <h2 id="claim-heading" className="font-heading font-semibold">Claim creator rewards</h2>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Collect SOL creator rewards into the verified treasury wallet. This action only claims rewards. Purchases and burns remain paused.</p>
    <p className="mt-3 text-sm">Available rewards: <span className="font-mono text-primary">{formatClaimSol(data.unclaimedSol)}</span> <span className="text-xs text-muted-foreground">· estimate</span></p>
    <p className="mt-2 text-xs text-muted-foreground">There is no 0.01 SOL buyback minimum for claims. Pump’s distribution minimum and network fees still apply.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Button variant="outline" disabled={!ui.canClaim} onClick={() => submit('claim')}>{mutation.isPending && mutation.variables?.action === 'claim' && <Loader2 className="animate-spin" />}Claim SOL rewards</Button>
      {ui.receipt?.claimVersion === 1 && ui.receipt.status === 'pending' && <Button variant="outline" disabled={!ui.canRecover} onClick={() => submit('recover')}>{mutation.isPending && mutation.variables?.action === 'recover' && <Loader2 className="animate-spin" />}Retry saved claim</Button>}
      <Button variant="ghost" disabled={refreshing || mutation.isPending} onClick={onRefresh}><RefreshCw className={refreshing ? 'animate-spin' : ''} />Refresh status</Button>
    </div>
    {ui.blockedReason && <p className="mt-3 text-xs text-muted-foreground">{ui.blockedReason}</p>}
    {ui.receipt?.claimVersion === 1 && ui.receipt.status === 'pending' && <p className="mt-2 text-xs text-muted-foreground">Retry checks the saved signature and may resend that exact transaction. It never creates a new claim.</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">Request error: {error}</p>}
    <p role="status" aria-live="polite" className={`mt-3 text-sm ${ui.phase === 'failed' ? 'text-destructive' : 'text-primary'}`}>
      {ui.phase === 'ready' && !ui.canClaim ? 'Claim unavailable until the condition above is resolved.' : ui.message}
      {ui.signature && <> <a className="underline" href={`https://solscan.io/tx/${ui.signature}`} target="_blank" rel="noreferrer">View transaction</a></>}
    </p>
  </section>;
}
