import type { ResolvedSiteCheckProConfig } from '../types.js';
import { matchesAny } from './pattern.js';

const BLOCKED_PROTOCOLS = new Set(['mailto:', 'tel:', 'javascript:', 'data:']);

export function normalizeUrl(
  raw: string,
  currentURL: string,
  config: ResolvedSiteCheckProConfig,
): string | null {
  try {
    const url = new URL(raw, currentURL);
    const base = new URL(config.baseURL);

    if (BLOCKED_PROTOCOLS.has(url.protocol)) return null;
    if (config.crawl.sameOriginOnly && url.origin !== base.origin) return null;

    url.hash = '';
    for (const key of config.crawl.ignoreQueryParams) url.searchParams.delete(key);
    url.searchParams.sort();

    const pathname = url.pathname || '/';
    if (!matchesAny(pathname, config.crawl.include)) return null;
    if (matchesAny(pathname, config.crawl.exclude)) return null;

    return url.toString();
  } catch {
    return null;
  }
}
