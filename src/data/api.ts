/** The only way pages change data (contract: src/data/types.ts). */
import { backend } from './backend';

export { GUARD_ERRORS, type AdminSession, type ContactRequestInput, type GuardError, type RequestError, type SignInResult } from './types';

export const api = backend.api;

/** Admin sign-in (the Admin Panel only). */
export const adminAuth = backend.admin;
