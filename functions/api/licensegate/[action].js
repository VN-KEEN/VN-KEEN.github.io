import { handle } from '../../../licensegate-service.mjs';
import { handleWalletWebhook } from '../../wallet-webhook.mjs';

export const onRequest = ({ request, env, params }) =>
  params.action === 'webhook'
    ? handleWalletWebhook(request, env)
    : handle(request, env, params.action);
