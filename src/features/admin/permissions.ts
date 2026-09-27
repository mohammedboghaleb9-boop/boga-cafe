/**
 * Admin roles and what each one can open.
 * Change a role's access here; the menu and the routes follow automatically.
 */
export type Role = 'owner' | 'manager' | 'staff';

export type Section =
  | 'dashboard'
  | 'orders'
  | 'b2b'
  | 'products'
  | 'stock'
  | 'shipping'
  | 'payments'
  | 'notifications'
  | 'content'
  | 'settings';

export const SECTIONS: Section[] = [
  'dashboard',
  'orders',
  'b2b',
  'products',
  'stock',
  'shipping',
  'payments',
  'notifications',
  'content',
  'settings',
];

export const ROLES: Role[] = ['owner', 'manager', 'staff'];

export const PERMISSIONS: Record<Role, Section[]> = {
  owner: SECTIONS,
  manager: ['dashboard', 'orders', 'b2b', 'products', 'stock', 'shipping', 'notifications', 'content'],
  staff: ['dashboard', 'orders', 'b2b', 'stock'],
};

export const can = (role: Role, section: Section) => PERMISSIONS[role].includes(section);

/** Staff can move stock but not change prices or origin details. */
export const canEditCatalog = (role: Role) => role !== 'staff';
