import { handlePayosWebhook } from '../payos-service.mjs';
export function onRequest({request,env}) { return handlePayosWebhook(request,env); }
