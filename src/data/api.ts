/** The only way pages change data (contract: src/data/types.ts). */
import { backend } from './backend';

export { GUARD_ERRORS, type ContactRequestInput, type GuardError, type RequestError } from './types';

export const api = backend.api;
