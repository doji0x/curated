import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';

export default function AdminV1History({ onCheck, busy, revision }) {
  const query = useQuery({ queryKey: ['admin-v1-history', revision], queryFn: async () => (await base44.functions.invoke('atomicV1PumpLaunch', { action: 'history' })).data.launches });
  return <section className="space-y-3 border-t border-border pt-6"><h2 className="font-heading text-lg font-semibold">Saved V1 launches</h2>
    {query.isPending && <p className="text-sm text-muted-foreground">Loading saved launches…</p>}
    {query.isError && <p role="alert" className="text-sm text-destructive">Unable to load launches. <button onClick={() => query.refetch()} className="underline">Retry</button></p>}
    {query.data?.length === 0 && <p className="text-sm text-muted-foreground">No admin V1 launches yet.</p>}
    {query.data?.map(row => <div key={row.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"><div className="min-w-0"><p className="truncate text-sm font-medium">{row.name} · {row.symbol}</p><p className="text-xs text-muted-foreground">{row.status} · {row.holderReward ? 'Holder rewards' : 'Creator rewards'}</p></div><Button variant="outline" size="sm" disabled={busy} onClick={() => onCheck(row.requestId)}>View / check</Button></div>)}
  </section>;
}