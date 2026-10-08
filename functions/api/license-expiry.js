import { handleLicenseExpiry } from '../license-expiry-service.mjs';

export const onRequest = ({ request, env }) => handleLicenseExpiry(request, env);
