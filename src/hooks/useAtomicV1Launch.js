import { useEffect, useRef, useState } from 'react';
import { base44 } from '@/api/base44Client';

const initial = { name: '', symbol: '', description: '', firstBuyAmount: '', quoteMint: 'So11111111111111111111111111111111111111112', creatorFeePercent: '0', holderReward: false };
const toBase64 = file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export default function useAtomicV1Launch() {
  const requestId = useRef(crypto.randomUUID());
  const [input, setInput] = useState(initial), [file, setFile] = useState(null), [imageBase64, setImageBase64] = useState('');
  // Links are off-chain, so they never affect the transaction size preview.
  const [links, setLinks] = useState({ website: '', twitter: '', github: '' });
  const [size, setSize] = useState(null), [sizing, setSizing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [result, setResult] = useState(null);
  useEffect(() => { let active = true; setImageBase64(''); setSize(null); if (file) toBase64(file).then(value => { if (active) setImageBase64(value); }).catch(() => { if (active) setError('Unable to read that image.'); }); return () => { active = false; }; }, [file]);
  useEffect(() => {
    setSize(null);
    if (!imageBase64 || !input.name || !input.symbol) { setSizing(false); return; }
    let active = true; setSizing(true);
    const timer = setTimeout(async () => { setError(''); try { const { data } = await base44.functions.invoke('atomicV1PumpLaunch', { action: 'size', requestId: requestId.current, imageBase64, ...input }); if (active) setSize(data.size); } catch (reason) { if (active) { setSize(null); setError(reason.response?.data?.error || reason.message); } } finally { if (active) setSizing(false); } }, 450);
    return () => { active = false; clearTimeout(timer); };
  }, [imageBase64, input]);
  async function check(targetId = result?.requestId || requestId.current) {
    const checked = await base44.functions.invoke('atomicV1PumpLaunch', { action: 'confirm', requestId: targetId });
    setResult(checked.data.launch); return checked.data.launch;
  }
  async function recheck(targetId) {
    setBusy(true); setError('');
    try { await check(typeof targetId === 'string' ? targetId : undefined); } catch (reason) { setError(reason.response?.data?.error || reason.message || 'Unable to check finalization.'); }
    finally { setBusy(false); }
  }
  async function launch(event) {
    event.preventDefault(); if (busy || result || !file || !size || sizing || size.remainingBytes < 0) return; setBusy(true); setError('');
    try {
      const upload = await base44.integrations.Core.UploadPublicFile({ file });
      const { data } = await base44.functions.invoke('atomicV1PumpLaunch', { action: 'launch', requestId: requestId.current, imageBase64, imageUrl: upload.file_url, socials: links, ...input });
      setResult(data.launch);
      for (let i = 0; i < 24 && data.launch.status === 'pending'; i += 1) { await wait(2500); const current = await check(data.launch.requestId); if (current.status !== 'pending') break; }
    } catch (reason) { setError(reason.response?.data?.error || reason.message || 'Atomic V1 launch failed.'); }
    finally { setBusy(false); }
  }
  const reset = () => { requestId.current = crypto.randomUUID(); setInput({ ...initial }); setFile(null); setImageBase64(''); setSize(null); setResult(null); setError(''); setLinks({ website: '', twitter: '', github: '' }); };
  return { input, setInput, file, setFile, size, sizing, busy, error, result, launch, reset, check: recheck, links, setLink: (key, value) => setLinks(current => ({ ...current, [key]: value })) };
}