import {handleSession,processPolicyJob} from '../../cs2-session-service.mjs';
export async function onRequest(context){
 if(context.env.LICENSE_DB)context.waitUntil(processPolicyJob(context.env));
 return handleSession(context.request,context.env,context.params.action);
}
