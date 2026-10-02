import React, { useEffect, useState } from 'react';
import { History, ShieldCheck, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import MintForm from '@/components/admin/MintForm';
import MintStatus from '@/components/admin/MintStatus';
import PumpLaunchPanel from '@/components/admin/PumpLaunchPanel';
import BackgroundMintJobs from '@/components/admin/BackgroundMintJobs';
import InscribedLaunchGuide from '@/components/launch/InscribedLaunchGuide';
import useInscribedMint from '@/hooks/useInscribedMint';
import PofControlPanel from '@/components/admin/PofControlPanel';
import AgentFartRequest from '@/components/admin/AgentFartRequest';

export default function AdminMint() {
  const urlParams = new URLSearchParams(window.location.search);
  const selectedMint = urlParams.get('mint') || '';
  const [user, setUser] = useState();
  const mint = useInscribedMint(user?.role === 'admin' ? user.id : null, selectedMint);
  useEffect(() => { base44.auth.me().then(setUser); }, []);
  if (!user) return <div className="validate-surface flex min-h-screen items-center justify-center"><div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" /></div>;
  if (user.role !== 'admin') return <main className="validate-surface flex min-h-screen items-center justify-center px-5"><div className="max-w-md rounded-2xl border border-border bg-card p-8 text-center"><h1 className="font-display text-xl font-semibold">Admin access required</h1><p className="mt-2 text-sm text-muted-foreground">This mint console is restricted to administrator accounts.</p><Link to="/" className="mt-5 inline-block text-sm text-primary underline">Return home</Link></div></main>;
  return <div className="validate-surface min-h-screen text-foreground">
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl"><div className="mx-auto flex h-14 max-w-2xl items-center gap-2 px-2"><Link to="/" aria-label="Close mint console" className="flex h-10 w-10 items-center justify-center rounded-full transition hover:bg-card"><X className="h-5 w-5" /></Link><div className="flex-1"><p className="font-mono text-[10px] leading-none tracking-[0.3em] text-primary">ADMIN · MAINNET</p><h1 className="font-display font-semibold leading-tight">Inscription console</h1></div><div className="flex items-center gap-2"><Link to="/launch-coin" className="flex h-9 items-center gap-2 rounded-full border border-primary/35 bg-card px-3 text-xs text-primary hover:bg-primary/10">Create coin</Link><Link to="/admin/mints" className="flex h-9 items-center gap-2 rounded-full border border-border bg-card px-3 text-xs text-muted-foreground hover:text-foreground"><History size={15} />History</Link></div></div></header>
    <main className="mx-auto max-w-2xl px-4 py-8 pb-24 sm:px-6"><div className="mb-7 flex items-start gap-3"><span className="rounded-2xl bg-primary p-2.5 text-primary-foreground"><ShieldCheck size={20} /></span><div><h2 className="font-display text-3xl font-bold tracking-tight">Mint an inscribed NFT</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Creates one single master NFT owned by the server mint wallet and writes its metadata and complete image bytes directly on-chain. No Arweave, IPFS, or external image URL is used.</p></div></div>
      <Link to="/admin/v1-launch" className="mb-6 block rounded-xl border border-primary/35 bg-card p-4 text-sm text-primary hover:bg-primary/10">Admin V1 launch · pair assets and creator / holder rewards</Link>
      <AgentFartRequest />
      <PofControlPanel />
      <InscribedLaunchGuide admin />
      <MintForm onMint={mint.start} busy={mint.busy} pending={mint.pending} onResume={mint.resume} initialMint={selectedMint} /><BackgroundMintJobs /><MintStatus {...mint} onResume={mint.resume} /><PumpLaunchPanel inscriptionBusy={mint.busy || mint.pending?.status === 'in_progress'} />
    </main>
  </div>;
}