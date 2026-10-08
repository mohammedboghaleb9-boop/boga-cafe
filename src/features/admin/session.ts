/**
 * The signed-in admin's role, for the Admin Panel's pages. The sign-in itself
 * lives with the data (src/data: the prototype's role picker, or Supabase Auth
 * on the live site); its rules are enforced by the database (RLS, is_admin()).
 */
import { useAdminSession } from '@/data/hooks';
import type { Role } from './permissions';

/** null unless signed in as an admin. */
export function useAdminRole(): Role | null {
  const session = useAdminSession();
  return session.state === 'signed_in' ? session.role : null;
}
