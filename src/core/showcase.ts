/**
 * The catalog shown without prices while the sales are closed (owner 2026-10-21): an item is on the site when it is
 * for sale (active) or listed for display. A listed item is never for sale by itself: the cart, src/core/order.ts and
 * the database sell active items only.
 */
export const onDisplay = (item: { active: boolean; listed?: boolean }): boolean => item.active || item.listed === true;
