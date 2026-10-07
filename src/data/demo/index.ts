import type { Backend, DataStatus } from '../types';
import { demoApi } from './api';
import { demoAdmin } from './session';
import { db } from './store';

const ready: DataStatus = 'ready';

/** Data kept in the visitor's browser (./store), rules applied by ./api: ready at once. */
export const demoBackend: Backend = {
  db,
  api: demoApi,
  status: { get: () => ready, subscribe: () => () => {} },
  retry: () => {},
  admin: demoAdmin,
};
