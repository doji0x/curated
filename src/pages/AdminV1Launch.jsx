import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import AdminV1Console from '@/components/atomic/AdminV1Console';

export default function AdminV1Launch() {
  const auth = useQuery({ queryKey: ['admin-v1-access'], queryFn: () => base44.auth.me() });
  if (auth.isPending) return <main className="flex min-h-screen items-center justify-center"><p role="status" className="text-muted-foreground">Checking admin access…</p></main>;
  if (auth.isError || auth.data?.role !== 'admin') return <main className="mx-auto max-w-lg space-y-4 px-5 py-16"><h1 className="text-xl font-semibold">Admin access required</h1><p className="text-sm text-muted-foreground">Only administrators can open this launch console.</p><Link to="/" className="text-primary underline">Return home</Link></main>;
  return <div className="validate-surface min-h-screen">
    <header className="border-b border-border bg-background"><div className="mx-auto flex h-14 max-w-2xl items-center gap-3 px-4"><Link to="/admin/mint" aria-label="Back to admin console" className="rounded-full p-2 hover:bg-muted"><ArrowLeft size={18} /></Link><h1 className="font-heading font-semibold">Admin V1 launch</h1><span className="ml-auto font-mono text-[10px] text-primary">MAINNET</span></div></header>
    <main className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6"><div><h2 className="font-display text-3xl font-semibold">Atomic V1 coin launch</h2><p className="mt-3 text-sm leading-6 text-muted-foreground">The existing server-signed V1 flow: create a Pump coin and embed the original image bytes in the same transaction, with your chosen pair asset and creator reward settings.</p><p className="mt-3 rounded-xl border border-border bg-card p-4 text-xs leading-5 text-muted-foreground">Uses the configured admin launch wallet, not Phantom. The exact V1 transaction must fit within 4,096 bytes and pass network simulation before submission. Images remain public for Pump metadata; V1 support depends on the network and RPC.</p></div><AdminV1Console /></main>
  </div>;
}