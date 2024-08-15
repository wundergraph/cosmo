import withMarkdoc from "@markdoc/next.js";
import { withSentryConfig } from "@sentry/nextjs";
import pkg from "./package.json" assert { type: "json" };

const isPreview = process.env.VERCEL_ENV === "preview";
// Allow it only for development once https://github.com/vercel/next.js/issues/23587 is fixed
const allowUnsafeEval = true;
// Report CSP violations to the console instead of blocking them
const debugCSP = false;
// Enable or disable the sentry integration
const isSentryEnabled = process.env.SENTRY_ENABLED === "true";
const sentryDebugEnabled = process.env.SENTRY_DEBUG === "true";
const sentryOrganization = process.env.SENTRY_ORGANIZATION || "";
const sentryProject = process.env.SENTRY_PROJECT || "";
const sentryAuthToken = process.env.SENTRY_AUTH_TOKEN || "";
if (isSentryEnabled) {
  if (sentryAuthToken) {
    console.warn(
      "sentry auth token not set, this will fail on uploading soure maps",
    );
  }
  if (sentryOrganization === "" || sentryProject === "") {
    console.warn(
      "sentry not configured properly please check your environment settings for the build",
    );
  }
}

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

/**
 * We can't enforce connect directives yet because the studio can connect to any public router.
 * Leave it open for now.
 */
// const fullCspHeader = `
//   default-src 'self' ${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL} ${
//     process.env.NEXT_PUBLIC_COSMO_CP_URL
//   };
//   connect-src 'self' ${process.env.NEXT_PUBLIC_COSMO_STUDIO_URL} ${
//     process.env.NEXT_PUBLIC_COSMO_CP_URL
//   } https://*.wundergraph.com wss://*.wundergraph.com https://plausible.io https://api.stripe.com https://maps.googleapis.com ${
//     isPreview
//       ? "https://vercel.live https://vercel.com *.pusher.com *.pusherapp.com"
//       : ""
//   };
//   ${lightweightCspHeader}
// `;

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
            value: lightweightCspHeader.replace(/\n/g, ""),
          },
        ],
      }
    ];
  },
};

const withOptionalSentryConfig = (org, project, config) =>
  withSentryConfig(config, {
    // For all available options, see:
    // https://github.com/getsentry/sentry-webpack-plugin#options

    org: org,
    project: project,
    sourcemaps: {
      disable: false,
      deleteSourcemapsAfterUpload: true,
    },

    telemetry: false,

    // Only print logs for uploading source maps in CI
    silent: !process.env.CI,

    // For all available options, see:
    // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

    // Upload a larger set of source maps for prettier stack traces (increases build time)
    widenClientFileUpload: true,

    // Uncomment to route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
    // This can increase your server load as well as your hosting bill.
    // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
    // side errors will fail.
    // tunnelRoute: "/monitoring",

    // Hides source maps from generated client bundles
    hideSourceMaps: true,
    reactComponentAnnotation: {
      enabled: true,
    },

    // Automatically tree-shake Sentry logger statements to reduce bundle size
    disableLogger: !sentryDebugEnabled,

    // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
    // See the following for more information:
    // https://docs.sentry.io/product/crons/
    // https://vercel.com/docs/cron-jobs
    automaticVercelMonitors: true,
  });

const withOptionalFeatures = (config) => {
  if (isSentryEnabled) {
    config = withOptionalSentryConfig(
      sentryOrganization,
      sentryProject,
      config,
    );
  }
  return config;
};

export default withOptionalFeatures(withMarkdoc({ mode: "static" })(config));
