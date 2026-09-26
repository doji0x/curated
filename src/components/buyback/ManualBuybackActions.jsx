import React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

export default function ManualBuybackActions({ data, onSubmitted }) {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => (await base44.functions.invoke('executeBurnBuyback', { action: 'claim' })).data,
    onSuccess: result => {
      if (!result.record) return;
      client.setQueryData(['burn-buybacks', 0], previous => previous ? { ...previous, hasPending: true, records: [result.record, ...previous.records.filter(row => row.id !== result.record.id)].slice(0, 20) } : previous);
      onSubmitted?.();
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['burn-buybacks'] }),
  });
  const busy = mutation.isPending || data.state.locked || data.hasPending;
  const error = mutation.error?.response?.data?.error || mutation.error?.message;
  return <section className="mt-5 rounded-2xl border border-border bg-card p-5">
    <h2 className="font-heading font-semibold">Claim creator rewards</h2>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Collect available SOL creator rewards into the verified treasury wallet. This action only claims rewards. Purchases and burns will be enabled after per-coin accounting is connected.</p>
    <p className="mt-2 text-xs text-muted-foreground">There is no 0.01 SOL buyback minimum for claims. Pump’s distribution minimum and network fees still apply.</p>
    <Button className="mt-4" variant="outline" disabled={busy || Boolean(data.claimError)} onClick={() => mutation.mutate()}>{mutation.isPending && <Loader2 className="animate-spin" />}Claim SOL rewards</Button>
    {busy && <p className="mt-3 text-xs text-muted-foreground">{mutation.isPending ? 'Preparing and submitting your claim…' : 'A saved transaction is awaiting confirmation. No new claim will be sent until it settles.'}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {mutation.data && <p role="status" className="mt-3 text-sm text-primary">{mutation.data.reason || mutation.data.message || 'Checking the saved transaction.'}{(mutation.data.record?.signature || mutation.data.signature) && <> <a className="underline" href={`https://solscan.io/tx/${mutation.data.record?.signature || mutation.data.signature}`} target="_blank" rel="noreferrer">View transaction</a></>}</p>}
  </section>;
}
