import withMarkdoc from "@markdoc/next.js";
import pkg from "./package.json" assert { type: "json" };

const isProd = process.env.NODE_ENV === "production";
const debugCSP = true

// Content Security Policy (CSP) is a security standard that helps prevent cross-site scripting (XSS),
// click-jacking, and other code injection attacks resulting from execution of malicious content
// in the trusted web page context.
// For more information see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
// Known provider content security policies:
// For Stripe see https://docs.stripe.com/security/guide?csp=csp-js#content-security-policy
// For Koala see https://getkoala.com/docs/sdk/installation
// 'unsafe-eval' is only used in development mode, when script is injected by Next.js

const cspHeader = `
  default-src 'self' ${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL} ${process.env.NEXT_PUBLIC_COSMO_CP_URL};
  script-src 'report-sample' 'self' 'unsafe-inline' ${isProd ? '' : "'unsafe-eval'"} https://js.stripe.com https://maps.googleapis.com https://plausible.io https://wundergraph.com https://*.getkoala.com
  style-src 'report-sample' 'self' 'unsafe-inline' data:;;
  object-src 'none';
  base-uri 'self';
  connect-src 'self' ${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL} ${process.env.NEXT_PUBLIC_COSMO_CP_URL} https://api.getkoala.com wss://*.getkoala.com https://*.getkoala.com https://api.stripe.com https://maps.googleapis.com;
  font-src 'self' data:;;
  frame-src 'self' https://js.stripe.com https://hooks.stripe.com;
  img-src 'self';
  manifest-src 'self';
  media-src 'self';
  worker-src 'none';
`

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  pageExtensions: ["md", "mdoc", "js", "jsx", "ts", "tsx"],
  headers: () => {

    // Replace newline characters and spaces
    const contentSecurityPolicyHeaderValue = cspHeader
        .replace(/\s{2,}/g, ' ')
        .trim()

    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: debugCSP ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy",
            value: cspHeader.replace(/\n/g, ''),
          },
        ],
      },
    ];
  },
  publicRuntimeConfig: {
    version: pkg.version,
  },
};

export default withMarkdoc({ mode: "static" })(config);
