import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import useAtomicV1Launch from '@/hooks/useAtomicV1Launch';
import AtomicV1Form from '@/components/atomic/AtomicV1Form';
import AtomicV1Result from '@/components/atomic/AtomicV1Result';
import AdminV1RewardOptions from '@/components/atomic/AdminV1RewardOptions';
import AdminV1History from '@/components/atomic/AdminV1History';

export default function AdminV1Console() {
  const state = useAtomicV1Launch();
  const options = useQuery({ queryKey: ['admin-v1-options'], queryFn: async () => (await base44.functions.invoke('atomicV1PumpLaunch', { action: 'options' })).data });
  if (options.isPending) return <p role="status" className="text-sm text-muted-foreground">Loading supported pair assets and reward settings…</p>;
  if (options.isError) return <div role="alert" className="space-y-3"><p className="text-sm text-destructive">{options.error?.response?.data?.error || options.error.message}</p><Button onClick={() => options.refetch()}>Retry settings</Button></div>;
  return <div className="space-y-7">
    {!state.result && <AtomicV1Form state={state} allowFirstBuy={false} launchDisabled={!options.data.pairs.length}><AdminV1RewardOptions input={state.input} setInput={state.setInput} settings={options.data} disabled={state.busy} /></AtomicV1Form>}
    <AtomicV1Result result={state.result} onCheck={state.check} busy={state.busy} />
    {state.result && state.error && <p role="alert" className="text-sm text-destructive">{state.error}</p>}
    {state.result && (['confirmed', 'failed', 'expired'].includes(state.result.status) || (state.result.status === 'prepared' && !state.result.transactionSignature)) && <Button variant="outline" disabled={state.busy} onClick={state.reset}>Start another V1 launch</Button>}
    <AdminV1History onCheck={state.check} busy={state.busy} revision={state.result?.checkedAt || ''} />
  </div>;
}