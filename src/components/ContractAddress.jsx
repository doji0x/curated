import React, { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';

const address = '6ZdCWrLhmBJmoLCL8reNCBxqJGBxXgQyM2PcDo4kpump';

export default function ContractAddress() {
  const [status, setStatus] = useState('');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address);
      setStatus('copied');
    } catch {
      setStatus('Could not copy. Select the address to copy it.');
    }
  };
  return <section aria-label="Contract address" className="mt-6 rounded-2xl border border-border bg-card p-5 text-left">
    <p className="font-mono text-[10px] tracking-widest text-primary">CONTRACT ADDRESS</p>
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <code className="min-w-0 flex-1 select-all break-all font-mono text-sm text-foreground">{address}</code>
      <Button type="button" size="sm" variant="outline" onClick={copy}>{status === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}{status === 'copied' ? 'Copied' : 'Copy'}</Button>
    </div>
    {status && <p role="status" className="mt-2 text-xs text-muted-foreground">{status === 'copied' ? 'Address copied.' : status}</p>}
  </section>;
}