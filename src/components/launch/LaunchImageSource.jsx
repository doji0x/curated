import React from 'react';
import { Link } from 'react-router-dom';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Image } from '@/components/ui/image';
import NormalLaunchImageField from '@/components/launch/NormalLaunchImageField';

export default function LaunchImageSource({ state }) {
  const { input, setInput, file, setFile, recovery } = state;
  return <section className="space-y-4 p-5 sm:p-6">
    <div><h2 className="font-heading font-semibold">Coin image</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Upload artwork, or use an existing NFT as an inscribed image source.</p></div>
    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Image source">
      {[['upload', 'Upload image'], ['inscribed', 'Use inscribed NFT']].map(([mode, label]) => <button key={mode} type="button" disabled={Boolean(recovery)} aria-pressed={input.launchMode === mode} onClick={() => setInput(current => ({ ...current, launchMode: mode }))} className={`rounded-xl border px-3 py-3 text-sm font-medium transition ${input.launchMode === mode ? 'border-primary/50 bg-primary/10 text-primary' : 'border-border bg-background/50 text-muted-foreground hover:text-foreground'}`}>{label}</button>)}
    </div>
    {input.launchMode === 'inscribed' ? <div className="space-y-2"><Label htmlFor="launch-inscription">Inscribed NFT mint *</Label><Input id="launch-inscription" required maxLength={44} value={input.inscribedMint} disabled={Boolean(recovery)} onChange={event => setInput(current => ({ ...current, inscribedMint: event.target.value }))} placeholder="Source NFT mint address" className="h-11 font-mono text-xs" /><p className="text-xs leading-5 text-muted-foreground">The image inscription is verified before launch; this does not create a new NFT. <Link to="/inscribe" className="text-primary underline">Inscribe an image</Link></p></div> : recovery ? <div className="flex items-center gap-3"><Image src={recovery.imageUrl} alt="Saved launch artwork" className="h-20 w-20 rounded-lg" fittingType="fit" /><p className="text-xs text-muted-foreground">Using the image and metadata from your saved launch.</p></div> : <NormalLaunchImageField file={file} setFile={setFile} />}
    <p className="text-xs leading-5 text-muted-foreground">{input.launchMode === 'upload' ? 'Image and metadata are stored off-chain. This static metadata file cannot be edited through Burn after launch.' : 'The coin uses the inscription metadata resolver; the original inscribed image remains separate from editable display metadata.'}</p>
  </section>;
}