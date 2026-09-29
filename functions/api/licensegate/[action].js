import { handle } from '../../../licensegate-service.mjs';
export const onRequest = ({ request, env, params }) => handle(request, env, params.action);
