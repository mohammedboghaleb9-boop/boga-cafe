import { describe, expect, it } from 'vitest';
import { canonicalFor, productCanonical } from '../canonical';

describe('canonicalFor: only pages a search engine may list, one address each', () => {
  it('gives the home page and the public pages their full address', () => {
    expect(canonicalFor('/')).toBe('https://bogacafe.ma/');
    expect(canonicalFor('/shop')).toBe('https://bogacafe.ma/shop');
    for (const p of ['single-origin', 'custom-blend', 'b2b', 'contact']) expect(canonicalFor(`/${p}`), p).toBe(`https://bogacafe.ma/${p}`);
  });

  it('ignores a trailing slash', () => {
    expect(canonicalFor('/shop/')).toBe('https://bogacafe.ma/shop');
    expect(canonicalFor('/shop//')).toBe('https://bogacafe.ma/shop');
  });

  it('gives nothing to the cart, checkout, orders, admin and unknown paths', () => {
    for (const p of ['/cart', '/checkout', '/order/abc', '/admin', '/admin/orders', '/nope', '/product', '/product/a/b', '/product/boga-signature']) expect(canonicalFor(p), p).toBeNull();
  });

  it('names a product page by its slug', () => {
    expect(productCanonical('boga-signature')).toBe('https://bogacafe.ma/product/boga-signature');
  });
});
