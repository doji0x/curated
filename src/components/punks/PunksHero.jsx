import React from 'react';
import { Image } from '@/components/ui/image';

const LOGO = 'https://media.base44.com/images/public/6aa8d3c82020abebe308c467/8d0945030_solana_pixel_avatar_under_1mb.png';

export default function PunksHero() {
  return <section className="pb-16 text-center sm:pb-20">
    <Image src={LOGO} alt="Burn logo" className="mx-auto h-36 w-36 rounded-3xl border border-primary/25 object-cover shadow-2xl shadow-primary/10 ring-1 ring-primary/20 sm:h-44 sm:w-44" />
    <div className="mt-7 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 font-mono text-[9px] tracking-[0.16em] text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" />BURN</div>
    <h1 className="mx-auto mt-5 max-w-2xl font-display text-[46px] font-bold leading-[0.98] tracking-[-3px] sm:text-[70px] sm:tracking-[-4px]">The on-chain canon<br /><span className="gold-text">for true collectors.</span></h1>
    <p className="mx-auto mt-7 max-w-xl text-sm leading-7 text-muted-foreground sm:text-base">Burn is a platform for collectors and creators. The work itself is preserved — its complete image bytes inscribed on Solana, not stored behind a link. No mutable media. No substituted files. No trust required. What enters the canon remains exactly what was collected.</p>
  </section>;
}