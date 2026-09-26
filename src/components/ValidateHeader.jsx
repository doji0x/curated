import React from 'react';
import { Github, Info } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Image } from '@/components/ui/image';
import MobileMenuSheet from '@/components/nav/MobileMenuSheet';

export default function ValidateHeader({ onLearn }) {
  return <header className="sticky top-0 z-40 border-b border-border/60 bg-background/80 backdrop-blur-xl">
    <div className="mx-auto flex h-14 max-w-2xl items-center justify-between px-4">
      <Link to="/" aria-label="Burn home" className="flex items-center gap-2.5"><Image src="https://media.base44.com/images/public/6aa8d3c82020abebe308c467/b4b8f84ae_Screenshot2026-09-26at125609PM.png" alt="Burn logo" className="h-8 w-8 rounded-lg ring-1 ring-primary/30" /><span className="leading-none"><span className="gold-text block font-display font-semibold tracking-[0.14em]">BURN</span><span className="mt-1 hidden font-mono text-[7px] tracking-[0.12em] text-muted-foreground sm:block">ON-CHAIN CURATION</span></span></Link>
      <div className="flex items-center gap-2"><Link to="/launch-coin" className="block h-8 rounded-full border border-primary/40 bg-primary/10 px-3 text-xs font-medium leading-8 text-primary transition hover:border-primary">Create coin</Link><a href="https://github.com/doji0x/Spunk" target="_blank" rel="noreferrer" aria-label="Documentation" className="hidden h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/50 hover:text-foreground sm:flex"><Github className="h-4 w-4" /></a>{onLearn && <button onClick={onLearn} aria-label="How it works" className="hidden h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition hover:border-primary/50 hover:text-foreground sm:flex"><Info className="h-4 w-4" /></button>}<MobileMenuSheet showLabel={false} triggerClassName="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-foreground transition hover:border-primary/50 hover:text-primary" /></div>
    </div>
  </header>;
}