import { handle } from '../../licensegate-service.mjs';

// The secure status handler requires the matching order bearer token and only
// releases a provider-verified license. The old KV/memory fallback is removed.
export function onRequest({ request, env }) {
  return handle(request, env, 'status');
}
