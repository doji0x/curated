import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { Image } from '@/components/ui/image';

export default function BuybackFeature() {
  return <section className="mt-6 rounded-3xl border border-primary/30 bg-card p-6 text-left sm:p-8" aria-labelledby="burn-buyback-heading">
    <div className="flex items-center gap-3"><Image src="https://media.base44.com/images/public/6aa8d3c82020abebe308c467/b4b8f84ae_Screenshot2026-09-26at125609PM.png" alt="Burn" className="h-12 w-12 rounded-xl" /><p className="font-mono text-[10px] tracking-widest text-primary">BURN BUYBACK PROGRAM</p></div>
    <h2 id="burn-buyback-heading" className="mt-5 font-display text-3xl font-bold tracking-tight"><span className="gold-text">80%</span> back into Burn.</h2>
    <p className="mt-3 text-sm leading-6 text-muted-foreground">Our reward program allocates 80% of verified claimed creator rewards to buy and burn Burn, with 20% retained in the treasury.</p>
    <p className="mt-3 text-xs leading-5 text-muted-foreground">When enabled, automation checks every five minutes and resumes unfinished claims, purchases and burns. Only verified reward allocations fund purchases. Buybacks and burns do not guarantee a price.</p>
    <Link to="/admin/buybacks" className="mt-5 inline-flex items-center gap-1 text-sm text-primary hover:underline">Buyback dashboard <span className="text-xs text-muted-foreground">· Admin</span><ArrowUpRight size={15} /></Link>
  </section>;
}
