import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import React from 'react';
import { create, act } from 'react-test-renderer';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Compile the real JSX and replace only the API boundary. No network or wallet.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@/api/base44Client') return { url: new URL('./mockBase44.mjs', import.meta.url).href, shortCircuit: true };
    const url = specifier.startsWith('@/') ? new URL(`../../src/${specifier.slice(2)}`, import.meta.url) :
      specifier.startsWith('.') && context.parentURL ? new URL(specifier, context.parentURL) : null;
    if (url?.protocol === 'file:' && !existsSync(url)) {
      for (const extension of ['.js', '.jsx']) if (existsSync(`${fileURLToPath(url)}${extension}`)) return { url: `${url.href}${extension}`, shortCircuit: true };
    }
    if (specifier.startsWith('@/')) return nextResolve(url.href, context);
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.endsWith('.jsx')) return { format: 'module', source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText, shortCircuit: true };
    return nextLoad(url, context);
  },
});
globalThis.window = { self: null, top: null };
const { default: AdminBuybacks } = await import('../../src/pages/AdminBuybacks.jsx');
const flush = async () => { for (let i = 0; i < 4; i++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); }); };
const text = node => typeof node === 'string' ? node : (node?.children || []).map(text).join('');
function button(view, label) { return view.root.findAllByType('button').find(node => text(node) === label); }
async function mount(t, { initial = null } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  const state = { receipt: initial, claims: [], failStatus: false, failClaim: false, delayClaim: null, queries: [] };
  globalThis.claimTestApi = {
    auth: { me: async () => ({ role: 'admin' }) },
    functions: { invoke: async (_, payload) => {
      if (payload.action === 'status') {
        state.queries.push(payload);
        if (state.failStatus) throw new Error('RPC status unavailable');
        return { data: { wallet: 'treasury', signerVerified: true, purchasesPaused: true, claimUiVersion: 1,
          claim: { wallet: 'treasury', route: 'sharing', shareBps: 10000 }, claimError: '', unclaimedSol: '5000000', walletBalance: '10000000',
          state: { locked: false }, totals: {}, hasPending: state.receipt?.status === 'pending',
          pendingRecord: state.receipt?.status === 'pending' ? state.receipt : null,
          trackedRecord: payload.signature === state.receipt?.signature ? state.receipt : null,
          records: state.receipt ? [state.receipt] : [] } };
      }
      state.claims.push(payload);
      if (state.delayClaim) await state.delayClaim;
      state.receipt ||= { id: 'receipt', signature: 'saved', status: 'pending', claimVersion: 1, createdAt: new Date().toISOString() };
      if (state.failClaim && payload.action === 'claim') throw new Error('Submission request timed out');
      return { data: { record: { ...state.receipt }, message: 'Waiting for finalization.' } };
    } },
  };
  let view;
  await act(async () => { view = create(React.createElement(QueryClientProvider, { client }, React.createElement(MemoryRouter, null, React.createElement(AdminBuybacks)))); });
  t.after(async () => { await act(async () => view.unmount()); client.clear(); });
  await flush();
  return { view, state, client };
}

test('real claim panel submits once and replaces pending text after finalization', async t => {
  const { view, state, client } = await mount(t);
  assert.equal(button(view, 'Claim SOL rewards').props.disabled, false);
  let release; state.delayClaim = new Promise(resolve => { release = resolve; });
  await act(async () => { const click = button(view, 'Claim SOL rewards').props.onClick; void click(); void click(); });
  await flush(); assert.equal(state.claims.length, 1); assert.deepEqual(state.claims[0], { action: 'claim' });
  assert.equal(button(view, 'Claim SOL rewards').props.disabled, true);
  await act(async () => release()); await flush();
  assert.equal(button(view, 'Retry saved claim').props.disabled, false);
  state.receipt = { ...state.receipt, status: 'confirmed', totalAccrued: '123456789' };
  await act(async () => { await client.invalidateQueries({ queryKey: ['burn-buybacks'] }); }); await flush();
  assert.match(text(view.toJSON()), /Claim finalized: 0\.123456789 SOL/);
  assert.doesNotMatch(text(view.toJSON()), /Waiting for the saved transaction/);
  assert.equal(button(view, 'Retry saved claim'), undefined);
  assert.ok(state.queries.some(query => query.signature === 'saved'));
});

test('real claim panel recovers only the saved signature after reload', async t => {
  const { view, state } = await mount(t, { initial: { id: 'existing', signature: 'saved', status: 'pending', claimVersion: 1, createdAt: new Date().toISOString() } });
  assert.equal(button(view, 'Claim SOL rewards').props.disabled, true);
  await act(async () => { await button(view, 'Retry saved claim').props.onClick(); }); await flush();
  assert.deepEqual(state.claims, [{ action: 'recover', signature: 'saved' }]);
});

test('real claim panel disables stale data after a failed refresh and restores it on success', async t => {
  const { view, state, client } = await mount(t);
  state.failStatus = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ['burn-buybacks'] }); }); await flush();
  assert.equal(button(view, 'Claim SOL rewards').props.disabled, true);
  assert.match(text(view.toJSON()), /RPC status unavailable/);
  state.failStatus = false;
  await act(async () => { await button(view, 'Refresh status').props.onClick(); }); await flush();
  assert.equal(button(view, 'Claim SOL rewards').props.disabled, false);
});

test('a timed-out submission refreshes into the saved receipt without creating a second claim', async t => {
  const { view, state } = await mount(t);
  state.failClaim = true; state.failStatus = true;
  await act(async () => { await button(view, 'Claim SOL rewards').props.onClick(); }); await flush();
  assert.equal(state.claims.length, 1);
  assert.equal(button(view, 'Claim SOL rewards').props.disabled, true);
  assert.match(text(view.toJSON()), /Submission request timed out/);
  state.failStatus = false;
  await act(async () => { await button(view, 'Refresh status').props.onClick(); }); await flush();
  assert.equal(button(view, 'Claim SOL rewards').props.disabled, true);
  assert.equal(button(view, 'Retry saved claim').props.disabled, false);
  assert.equal(state.claims.length, 1);
});
