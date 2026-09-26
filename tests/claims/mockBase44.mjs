// Used only by the component-test resolver; never imported by application code.
export const base44 = {
  auth: { me: (...args) => globalThis.claimTestApi.auth.me(...args) },
  functions: { invoke: (...args) => globalThis.claimTestApi.functions.invoke(...args) },
};
