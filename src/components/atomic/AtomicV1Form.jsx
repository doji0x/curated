import React from 'react';
import { Loader2, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import AtomicV1SizeMeter from './AtomicV1SizeMeter';
import AtomicV1ImagePreview from './AtomicV1ImagePreview';
import AtomicV1ImageLimitNotice from './AtomicV1ImageLimitNotice';
import LaunchLinksFields from '@/components/launch/LaunchLinksFields';

export default function AtomicV1Form({ state, allowFirstBuy = true, launchDisabled = false, allowUnestimatedSubmit = false, children }) {
  const { input, setInput, file, setFile, size, sizing, busy, error, launch, links, setLink } = state;
  const set = (key, value) => setInput({ ...input, [key]: value });
  return <form onSubmit={launch} className="space-y-5">
    <div className="space-y-2"><Label htmlFor="atomic-image">Pump image + transaction inscription</Label><Input id="atomic-image" type="file" required accept="image/png,image/jpeg,image/gif,image/webp" disabled={busy} className="h-auto bg-card py-3 file:text-primary" onChange={event => setFile(event.target.files?.[0] || null)} /><p className="text-xs leading-5 text-muted-foreground">The exact uploaded bytes are hosted for normal Pump metadata and embedded unchanged in the V1 launch transaction.</p></div>
    <div className="grid gap-4 sm:grid-cols-[1fr_150px]"><div className="space-y-2"><Label htmlFor="atomic-name">Coin name</Label><Input id="atomic-name" required maxLength={32} value={input.name} disabled={busy} onChange={e => set('name', e.target.value)} /></div><div className="space-y-2"><Label htmlFor="atomic-symbol">Ticker</Label><Input id="atomic-symbol" required maxLength={10} value={input.symbol} disabled={busy} className="font-mono uppercase" onChange={e => set('symbol', e.target.value.toUpperCase())} /></div></div>
    <div className="space-y-2"><Label htmlFor="atomic-description">Description</Label><Input id="atomic-description" maxLength={280} value={input.description} disabled={busy} onChange={e => set('description', e.target.value)} /></div>
    {allowFirstBuy && <div className="space-y-2"><Label htmlFor="atomic-buy">Optional first buy (SOL)</Label><Input id="atomic-buy" inputMode="decimal" pattern="^\d+(\.\d+)?$" value={input.firstBuyAmount} disabled={busy} placeholder="Leave blank for create only" className="font-mono" onChange={e => set('firstBuyAmount', e.target.value)} /></div>}
    {children}
    <AtomicV1ImagePreview file={file} size={size} />
    <div className="space-y-2"><Label className="text-sm">Standard links</Label><p className="text-xs leading-5 text-muted-foreground">Served off-chain with the coin metadata and editable after launch.</p><LaunchLinksFields links={links} onChange={setLink} disabled={busy} /></div>
    <AtomicV1SizeMeter size={size} loading={sizing} hasFile={!!file} />
    {!sizing && !size && <AtomicV1ImageLimitNotice file={file} />}
    {file && <p className="font-mono text-[10px] text-muted-foreground">Selected raw file: {file.size.toLocaleString()} bytes</p>}{error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" disabled={launchDisabled || busy || (!allowUnestimatedSubmit && (sizing || !size || size.remainingBytes < 0))} className="gold-glow w-full rounded-full"><Rocket />{busy ? <><Loader2 className="animate-spin" />Launching and verifying...</> : 'Launch atomic V1 coin'}</Button>
  </form>;
}