import withMarkdoc from "@markdoc/next.js";
import pkg from "./package.json" assert { type: "json" };

const isPreview = process.env.VERCEL_ENV === "preview";
// Allow it only for development once https://github.com/vercel/next.js/issues/23587 is fixed
const allowUnsafeEval = true
// Report CSP violations to the console instead of blocking them
const debugCSP = false

// Content Security Policy (CSP) is a security standard that helps prevent cross-site scripting (XSS),
// clickjacking, and other code injection attacks resulting from execution of malicious content
// in the trusted web page context.
// For more information see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
// Known provider content security policies:
// For Stripe see https://docs.stripe.com/security/guide?csp=csp-js#content-security-policy
// For Koala see https://getkoala.com/docs/sdk/installation
// Vercel Preview Environment see https://vercel.com/docs/workflow-collaboration/comments/specialized-usage#using-a-content-security-policy
// Important: 'unsafe-eval' is only used in development mode, when script is injected by Next.js

const cspHeader = `
  default-src 'self' ${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL} ${process.env.NEXT_PUBLIC_COSMO_CP_URL};
  script-src 'report-sample' 'self' 'unsafe-inline' ${allowUnsafeEval ? "'unsafe-eval'" : ''} https://*.wundergraph.com https://js.stripe.com https://maps.googleapis.com https://plausible.io https://wundergraph.com https://*.getkoala.com ${isPreview ? 'https://vercel.live https://vercel.com' : ''};
  style-src 'report-sample' 'self' 'unsafe-inline' data:;;
  object-src 'none';
  base-uri 'self';
  connect-src 'self' ${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL} ${process.env.NEXT_PUBLIC_COSMO_CP_URL} https://*.wundergraph.com https://api.getkoala.com wss://*.getkoala.com https://plausible.io https://*.getkoala.com https://api.stripe.com https://maps.googleapis.com ${isPreview ? 'https://vercel.live https://vercel.com *.pusher.com *.pusherapp.com' : ''};
  font-src 'self' data:;;
  frame-src 'self' https://js.stripe.com https://hooks.stripe.com ${isPreview ? 'https://vercel.live/ https://vercel.com' : ''};
  img-src 'self' ${isPreview ? 'https://vercel.live/ https://vercel.com *.pusher.com/ data: blob:' : ''};
  manifest-src 'self';
  media-src 'self';
  worker-src 'self';
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
