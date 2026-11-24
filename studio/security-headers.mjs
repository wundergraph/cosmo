/**
 * @typedef {{ key: string; value: string }} Header
 * @typedef {{ type: 'query'; key: string; value: string }} QueryMatch
 * @typedef {{ source: string; has?: QueryMatch[]; missing?: QueryMatch[]; headers: Header[] }} HeaderRule
 */

/**
 * The source Hub frames Studio from. A Docker image keeps its placeholder, which entrypoint.sh swaps for the
 * runtime value in the built routes manifest.
 *
 * @param {string | undefined} hubUrl
 * @returns {string | undefined}
 */
const hubFrameAncestor = (hubUrl) => {
  if (!hubUrl) {
    return undefined;
  }

  if (/^https?:\/\//.test(hubUrl) && URL.canParse(hubUrl)) {
    return new URL(hubUrl).origin;
  }

  if (/^APP_NEXT_[A-Z_]+$/.test(hubUrl)) {
    return hubUrl;
  }

  return undefined;
};

/**
 * Header rules for every Studio response. Hub may frame a page requested with `embed=1`; /embed/session and
 * every other response refuse framing. Without a Hub URL nothing is framable.
 *
 * @param {{ csp: Header; hubUrl: string | undefined }} options
 * @returns {HeaderRule[]}
 */
export const securityHeaders = ({ csp, hubUrl }) => {
  const noSniff = { key: 'X-Content-Type-Options', value: 'nosniff' };
  const unframable = [noSniff, { key: 'X-Frame-Options', value: 'DENY' }, csp];

  const ancestor = hubFrameAncestor(hubUrl);
  if (!ancestor) {
    return [{ source: '/(.*)', headers: unframable }];
  }

  /** @type {QueryMatch[]} */
  const embed = [{ type: 'query', key: 'embed', value: '1' }];

  return [
    { source: '/(.*)', missing: embed, headers: unframable },
    { source: '/embed/session(.*)', has: embed, headers: unframable },
    {
      source: '/:path((?!embed/session).*)',
      has: embed,
      headers: [noSniff, { key: csp.key, value: `${csp.value.trim()} frame-ancestors ${ancestor};` }],
    },
  ];
};
