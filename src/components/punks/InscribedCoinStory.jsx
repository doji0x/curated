import React from 'react';
import { Gem, Link2, Rocket } from 'lucide-react';

const stages = [
  {
    icon: Gem,
    number: '01',
    title: 'Curate the work',
    text: 'Curation begins with a specific one-of-one work—not a replaceable media file. Its exact image bytes are verified, inscribed across Solana accounts, and reconstructed from the chain before it enters the Burn canon.',
  },
  {
    icon: Link2,
    number: '02',
    title: 'Bind the coin to the inscription',
    text: 'The completed inscription becomes the master artifact behind the launch. Its on-chain identity is carried into the coin’s metadata, creating a direct, verifiable relationship between the pump.fun coin and the preserved work.',
  },
  {
    icon: Rocket,
    number: '03',
    title: 'Launch without replacing the master',
    text: 'The creator keeps the inscribed master NFT while the coin launches as its own market on pump.fun. Collectors can trace the coin back to the work; the coin expands participation without becoming—or substituting—the original.',
  },
];

export default function InscribedCoinStory() {
  return <div className="mt-4 overflow-hidden rounded-2xl border border-primary/25 bg-primary/5">
    <div className="border-b border-primary/15 p-5 sm:p-6">
      <p className="font-mono text-[9px] tracking-[0.18em] text-primary">A FIRST FOR PUMP.FUN</p>
      <h3 className="mt-2 font-display text-2xl font-semibold tracking-tight">From inscribed artwork to a live coin.</h3>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Burn created a new launch path: a pump.fun coin whose image is not merely uploaded as ordinary off-chain media, but originates from a fully inscribed work preserved on Solana. The coin can move through a live market while its visual source remains independently readable and verifiable on-chain.</p>
    </div>
    <div className="grid gap-px bg-primary/15 sm:grid-cols-3">
      {stages.map(({ icon: Icon, number, title, text }) => <article key={number} className="bg-card p-5 sm:p-6">
        <div className="flex items-center justify-between"><Icon className="h-5 w-5 text-primary" /><span className="font-mono text-[9px] text-primary">/ {number}</span></div>
        <h4 className="mt-5 font-display text-base font-semibold">{title}</h4>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">{text}</p>
      </article>)}
    </div>
    <p className="border-t border-primary/15 p-5 text-sm leading-6 text-foreground sm:p-6"><strong className="text-primary">The breakthrough is the relationship.</strong> The artwork has its own immutable provenance. The coin has its own mint and market. Burn connects the two without reducing the work to a temporary URL or asking collectors to trust that today’s image will still be there tomorrow.</p>
  </div>;
}