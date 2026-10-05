/** The only way pages change data (contract: src/data/types.ts). */
import { backend } from './backend';

export type { ContactRequestInput, RequestError } from './types';

export const api = backend.api;
