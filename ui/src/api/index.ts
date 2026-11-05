import { resolveApiConfig } from './config';

export const { baseUrl, root, swaggerUrl } = resolveApiConfig(import.meta.env);
export { endpoints } from './endpoints';
