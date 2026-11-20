import type { AnalyticsWindow } from './window.js';

const PAGE_PATHS = {
  analytics: 'analytics',
  traces: 'analytics/traces',
  operations: 'operations',
} as const;

/**
 * A link to the Studio page showing the same data, so a user can check a tool's answer.
 */
export function studioUrl(
  webURL: string,
  organizationSlug: string,
  namespace: string,
  graph: string,
  page: keyof typeof PAGE_PATHS,
  params?: Record<string, string>,
): string {
  const path = [organizationSlug, namespace, 'graph', graph].map((segment) => encodeURIComponent(segment)).join('/');
  const url = new URL(`${path}/${PAGE_PATHS[page]}`, webURL.endsWith('/') ? webURL : `${webURL}/`);
  for (const [key, value] of Object.entries(params ?? {})) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

/** The window as Studio's analytics pages read it from the URL. */
export function studioWindowParams(window: AnalyticsWindow): Record<string, string> {
  return window.dateRange ? { dateRange: JSON.stringify(window.dateRange) } : { range: String(window.range) };
}
