import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import BuybackSummary from '@/components/buyback/BuybackSummary';
import BuybackRecords from '@/components/buyback/BuybackRecords';
import ManualBuybackActions from '@/components/buyback/ManualBuybackActions';

export default function AdminBuybacks() {
  const [offset, setOffset] = useState(0);
  const user = useQuery({ queryKey: ['buyback-admin'], queryFn: () => base44.auth.me() });
  const query = useQuery({ queryKey: ['burn-buybacks', offset], queryFn: async () => (await base44.functions.invoke('executeBurnBuyback', { action: 'status', offset })).data, enabled: user.data?.role === 'admin', refetchInterval: query => query.state.data?.hasPending || query.state.data?.state.locked ? 5000 : 60000, retry: false });
  if (user.isLoading) return <main className="flex min-h-screen items-center justify-center"><Loader2 className="animate-spin text-primary" /></main>;
  if (user.data?.role !== 'admin') return <main className="p-10 text-center">Admin access required. <Link to="/" className="text-primary underline">Back to Burn</Link></main>;
  const error = query.error;
  return <div className="validate-surface min-h-screen text-foreground">
    <header className="border-b border-border bg-background/80"><div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4"><Link to="/" aria-label="Back to Burn"><ArrowLeft size={20} /></Link><div><p className="font-mono text-[10px] tracking-widest text-primary">ADMIN · BURN</p><h1 className="font-heading font-semibold">Buyback dashboard</h1></div></div></header>
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4"><div><h2 className="font-display text-3xl font-bold">Creator rewards, accounted for.</h2><p className="mt-2 text-sm text-muted-foreground">Claim creator rewards · verify every receipt</p></div><div className="flex gap-2"><Button variant="outline" disabled={query.isFetching} onClick={() => query.refetch()}><RefreshCw className={query.isFetching ? 'animate-spin' : ''} />Refresh</Button></div></div>
      {error && <p role="alert" className="mb-5 rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error.response?.data?.error || error.message}</p>}
      {query.isLoading && <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="animate-spin" size={18} />Reading wallet and reward vaults…</p>}
      {query.data && <><BuybackSummary data={query.data} /><ManualBuybackActions data={query.data} onSubmitted={() => setOffset(0)} /><BuybackRecords rows={query.data.records} offset={offset} onPage={setOffset} loading={query.isFetching} /></>}
    </main>
  </div>;
}