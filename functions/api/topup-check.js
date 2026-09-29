import { handleUser } from '../wallet-service.mjs';

// This compatibility URL only returns the authenticated session's own wallet.
// A caller-supplied username or deposit code never grants access to an account.
export function onRequest({ request, env }) {
  return handleUser(request, env, 'me');
}
