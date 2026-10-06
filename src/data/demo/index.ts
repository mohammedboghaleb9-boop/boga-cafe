import type { Backend } from '../types';
import { demoApi } from './api';
import { db } from './store';

/** Data kept in the visitor's browser (./store), rules applied by ./api. */
export const demoBackend: Backend = { db, api: demoApi };
