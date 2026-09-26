import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

const sol = value => { const n = BigInt(value || '0'); return `${n / 1000000000n}.${String(n % 1000000000n).padStart(9, '0')}`.replace(/\.?0+$/, ''); };
export default function ManualBuybackActions({ data, onSubmitted }) {
  const [open, setOpen] = useState(false), [amount, setAmount] = useState(''), [validation, setValidation] = useState('');
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: async payload => (await base44.functions.invoke('executeBurnBuyback', payload)).data,
    onSuccess: result => {
      if (!result.record) return;
      client.setQueryData(['burn-buybacks', 0], previous => previous ? { ...previous, hasPending: true, records: [result.record, ...previous.records.filter(row => row.id !== result.record.id)].slice(0, 20) } : previous);
      onSubmitted?.();
    },
    onSettled: () => client.invalidateQueries({ queryKey: ['burn-buybacks'] }),
  });
  const busy = mutation.isPending || data.state.locked || data.hasPending;
  function buy(event) {
    event.preventDefault(); setValidation('');
    if (!/^(0|[1-9]\d*)(\.\d{1,9})?$/.test(amount.trim())) return setValidation('Enter SOL with up to 9 decimal places.');
    const [whole, fraction = ''] = amount.trim().split('.');
    const lamports = BigInt(whole) * 1000000000n + BigInt(fraction.padEnd(9, '0'));
    if (lamports < BigInt(data.minimumBuy)) return setValidation('The minimum buy is 0.01 SOL.');
    if (lamports > BigInt(data.availableSol)) return setValidation('This amount would use the protected operating reserve.');
    mutation.mutate({ action: 'buy', amount: String(lamports) });
  }
  const error = validation || mutation.error?.response?.data?.error || mutation.error?.message;
  return <section className="mt-5 rounded-2xl border border-border bg-card p-5">
    <h2 className="font-heading font-semibold">Manual actions</h2>
    <p className="mt-2 text-xs leading-5 text-muted-foreground">Available above reserve: <span className="font-mono text-primary">{sol(data.availableSol)} SOL</span> · Reserve: {sol(data.gasReserve)} SOL. Buys also leave room for fees and rent; they purchase Burn, not destroy tokens.</p>
    <p className="mt-1 text-xs text-muted-foreground">Claim SOL rewards buys Burn using this wallet’s available balance, less transaction costs; it does not collect from a reward vault. Manual controls work while automation is paused.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <Button variant="outline" disabled={busy} onClick={() => { setValidation(''); mutation.mutate({ action: 'claim' }); }}>{mutation.isPending && mutation.variables?.action === 'claim' && <Loader2 className="animate-spin" />}Claim SOL rewards</Button>
      <Button variant="outline" disabled={busy} onClick={() => { setOpen(!open); setValidation(''); mutation.reset(); }}>Manual buy</Button>
    </div>
    {open && <form onSubmit={buy} className="mt-4 flex flex-wrap items-end gap-3"><label className="min-w-0 text-xs text-muted-foreground" htmlFor="manual-buy-sol">Amount in SOL<Input id="manual-buy-sol" className="mt-2 w-56 max-w-full" inputMode="decimal" placeholder="0.01" maxLength={24} value={amount} onChange={event => setAmount(event.target.value)} disabled={busy} required /></label><Button type="submit" disabled={busy}>{mutation.isPending && mutation.variables?.action === 'buy' && <Loader2 className="animate-spin" />}Confirm buy</Button></form>}
    {busy && <p className="mt-3 text-xs text-muted-foreground">{mutation.isPending ? 'Preparing and submitting your transaction…' : 'A transaction or worker is in progress. Controls unlock after it settles.'}</p>}
    {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
    {mutation.data && <p role="status" className="mt-3 text-sm text-primary">{mutation.data.reason || mutation.data.message || (mutation.data.record ? 'Transaction submitted. Confirmation will update automatically.' : 'A transaction is awaiting confirmation.')}{(mutation.data.record?.signature || mutation.data.signature) && <> <a className="underline" href={`https://solscan.io/tx/${mutation.data.record?.signature || mutation.data.signature}`} target="_blank" rel="noreferrer">View transaction</a></>}</p>}
  </section>;
}