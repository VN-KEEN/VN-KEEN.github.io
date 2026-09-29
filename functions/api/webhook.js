import { handleWalletWebhook } from '../wallet-webhook.mjs';

export function onRequest({ request, env }) {
  return handleWalletWebhook(request, env);
}
