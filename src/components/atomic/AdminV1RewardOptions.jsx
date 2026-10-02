import React from 'react';
import PairAssetSelect from '@/components/admin/PairAssetSelect';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export default function AdminV1RewardOptions({ input, setInput, settings, disabled }) {
  const set = (key, value) => setInput(current => ({ ...current, [key]: value }));
  const pair = settings.pairs.find(item => item.mint === input.quoteMint);
  return <fieldset disabled={disabled} className="space-y-5 rounded-xl border border-border p-4">
    <legend className="px-2 font-heading text-sm font-semibold">Advanced creator rewards</legend>
    <PairAssetSelect options={settings.pairs} value={input.quoteMint} disabled={disabled} onChange={value => set('quoteMint', value)} />
    <div className="space-y-2"><Label htmlFor="admin-v1-buy">Optional first buy ({pair?.symbol || 'pair asset'})</Label><Input id="admin-v1-buy" inputMode="decimal" pattern="^\d+(\.\d+)?$" value={input.firstBuyAmount} placeholder="Leave blank for create only" onChange={e => set('firstBuyAmount', e.target.value)} /><p className="text-xs text-muted-foreground">Paid by the existing admin launch wallet; SOL is also required for rent and fees.</p></div>
    <div className="space-y-2"><Label htmlFor="admin-v1-fee">Creator fee (%)</Label><Input id="admin-v1-fee" type="number" min="0" step="0.01" max={settings.maxCreatorFeeBps / 100} disabled={disabled || !settings.creatorFeeConfigurable} value={input.creatorFeePercent} onChange={e => set('creatorFeePercent', e.target.value)} /><p className="text-xs text-muted-foreground">0 uses Pump’s default fee. {settings.creatorFeeConfigurable ? `Custom rates up to ${(settings.maxCreatorFeeBps / 100).toFixed(2)}% are currently enabled.` : 'Custom creator fee rates are currently disabled by Pump.'}</p></div>
    <div className="space-y-2"><Label htmlFor="admin-v1-rewards">Reward destination</Label><select id="admin-v1-rewards" value={input.holderReward ? 'holders' : 'creator'} onChange={e => set('holderReward', e.target.value === 'holders')} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"><option value="creator">Creator · admin launch wallet</option><option value="holders" disabled={!settings.holderRewardEnabled}>Token holders{!settings.holderRewardEnabled ? ' · currently unavailable' : ''}</option></select><p className="text-xs text-muted-foreground">Holder rewards route the full creator-fee destination to Pump’s holder rewards program instead of the creator wallet.</p></div>
  </fieldset>;
}