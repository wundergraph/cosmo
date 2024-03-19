import withMarkdoc from "@markdoc/next.js";
import pkg from "./package.json" assert { type: "json" };

const isPreview = process.env.VERCEL_ENV === "preview";
// Allow it only for development once https://github.com/vercel/next.js/issues/23587 is fixed
const allowUnsafeEval = true;
// Report CSP violations to the console instead of blocking them
const debugCSP = false;

// Content Security Policy (CSP) is a security standard that helps prevent cross-site scripting (XSS),
// clickjacking, and other code injection attacks resulting from execution of malicious content
// in the trusted web page context.
// For more information see https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy
// Known provider content security policies:
// For Stripe see https://docs.stripe.com/security/guide?csp=csp-js#content-security-policy
// Vercel Preview Environment see https://vercel.com/docs/workflow-collaboration/comments/specialized-usage#using-a-content-security-policy
// Important: 'unsafe-eval' is only used in development mode, when script is injected by Next.js

const lightweightCspHeader = `
  style-src 'report-sample' 'self' 'unsafe-inline' data:;;
  object-src 'none';
  base-uri 'self';
  font-src 'self' data:;;
  frame-src 'self' https://js.stripe.com https://hooks.stripe.com ${
    isPreview ? "https://vercel.live/ https://vercel.com" : ""
  };
  img-src 'self' ${
    isPreview
      ? "https://vercel.live/ https://vercel.com *.pusher.com/ data: blob:"
      : ""
  };
   script-src 'report-sample' 'self' 'unsafe-inline' ${
    allowUnsafeEval ? "'unsafe-eval'" : ""
  } https://*.wundergraph.com https://js.stripe.com https://maps.googleapis.com https://plausible.io https://wundergraph.com ${
      isPreview ? "https://vercel.live https://vercel.com" : ""
  };
  manifest-src 'self';
  media-src 'self';
  worker-src 'self';
`;

const fullCspHeader = `
  default-src 'self' ${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL} ${
    process.env.NEXT_PUBLIC_COSMO_CP_URL
  };
  connect-src 'self' ${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL} ${
    process.env.NEXT_PUBLIC_COSMO_CP_URL
  } https://*.wundergraph.com wss://*.wundergraph.com https://plausible.io https://api.stripe.com https://maps.googleapis.com ${
    isPreview
      ? "https://vercel.live https://vercel.com *.pusher.com *.pusherapp.com"
      : ""
  };
  ${lightweightCspHeader}
`;

/** @type {import("next").NextConfig} */
const config = {
  output: "standalone",
  pageExtensions: ["md", "mdoc", "js", "jsx", "ts", "tsx"],
  publicRuntimeConfig: {
    version: pkg.version,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: debugCSP
                ? "Content-Security-Policy-Report-Only"
                : "Content-Security-Policy",
            value: fullCspHeader.replace(/\n/g, ""),
          },
        ],
      },
      {
        // Allow the playground to make requests to the public router that can be hosted on a different domain
        source: "/(.*)/playground",
        headers: [
          {
            key: debugCSP
              ? "Content-Security-Policy-Report-Only"
              : "Content-Security-Policy",
            value: lightweightCspHeader.replace(/\n/g, ""),
          },
        ],
      },

    ];
  },
};

export default withMarkdoc({ mode: "static" })(config);
