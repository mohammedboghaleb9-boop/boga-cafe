import { ADMIN_WRITE_AREAS, type AdminAuth, type Backend, type DataStatus } from '../types';
import { demoApi } from './api';
import { demoAdmin } from './session';
import { db } from './store';

const ready: DataStatus = 'ready';
const readyStatus = { get: () => ready, subscribe: () => () => {} };

/** The browser-only real site has no Admin Panel (src/app/App.tsx): nobody signs in, and no demo password ships. */
const noAdmin: AdminAuth = {
  session: { get: () => ({ state: 'signed_out' }), subscribe: () => () => {} },
  signIn: async () => 'credentials',
  signOut: async () => {},
  dismiss: () => {},
  retry: () => {},
};

/** Data kept in the visitor's browser (./store), rules applied by ./api: ready at once. */
export const demoBackend: Backend = {
  db,
  api: demoApi,
  status: readyStatus,
  retry: () => {},
  admin: import.meta.env.VITE_DATA_MODE === 'demo' ? demoAdmin : noAdmin,
  // the prototype's panel reads and changes the same browser store
  adminData: { db, status: readyStatus, reload: () => {} },
  adminWrites: ADMIN_WRITE_AREAS,
};
