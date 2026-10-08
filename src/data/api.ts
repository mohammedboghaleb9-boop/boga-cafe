/** The only way pages change data (contract: src/data/types.ts). */
import { backend } from './backend';

export { GUARD_ERRORS, type AdminSession, type CodeResult, type ContactRequestInput, type GuardError, type RequestError, type SignInResult, type TotpSetup } from './types';

export const api = backend.api;

/** Admin sign-in (the Admin Panel only). */
export const adminAuth = backend.admin;
