import { handleUser } from '../wallet-service.mjs';

// Keep the Pages route thin: all wallet identity, balance, inventory, and
// idempotency rules are implemented by the shared D1-backed service.
export const onRequest = ({ request, env }) => handleUser(request, env);
