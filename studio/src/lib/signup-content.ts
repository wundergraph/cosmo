/**
 * Signup page content configuration
 * Defines different content variants for the signup page based on URL parameters
 */

export interface MarketingFeature {
  icon: string; // Icon name/key to identify which icon to use
  title: string;
  description: string;
}

export interface SignupContent {
  heading: string;
  description: string;
  marketingTitle: string;
  marketingDescription: string;
  features: MarketingFeature[];
}

export type SignupVariant = "default" | "apollo";

const signupContentMap: Record<SignupVariant, SignupContent> = {
  default: {
    heading: "Sign up for free",
    description: "Try Cosmo as Managed Service. No card required.",
    marketingTitle: "Cosmo: Open-Source\nGraphQL Federation Solution",
    marketingDescription:
      "Unify distributed APIs into one federated graph. Platform teams get observability and control. Service teams ship independently.",
    features: [
      {
        icon: "share",
        title: "Federate Any API, Not Just GraphQL",
        description:
          "Connect REST, gRPC, and GraphQL services without rewrites. Cosmo Connect wraps existing APIs into your graph without forcing migrations.",
      },
      {
        icon: "magnifying-glass",
        title: "Track Every Query Across Your Entire Graph",
        description:
          "Native OpenTelemetry tracing from gateway to subgraph. Find slow queries and failing services in seconds with zero instrumentation required.",
      },
      {
        icon: "shield-check",
        title: "Catch Breaking Changes Before Deployment",
        description:
          "Schema checks run automatically in CI/CD. Service teams ship on their own schedule, while platform teams prevent breaking changes from reaching production.",
      },
      {
        icon: "rocket-launch",
        title: "Built for Scale and Performance",
        description:
          "Go router with sub-millisecond overhead. Deploy with built-in caching, rate limiting, and security controls wherever your infrastructure lives.",
      },
    ],
  },
  apollo: {
    heading: "Sign up for free",
    description: "Try Cosmo managed and migrate from Apollo GraphOS in minutes. All you need is your API key.",
    marketingTitle: "Migrate to Cosmo\nfrom Apollo GraphOS",
    marketingDescription:
      "Escape the vendor lock. 100% open source GraphQL Federation with full control. A drop-in GraphOS replacement.",
    features: [
      {
        icon: "magnifying-glass",
        title: "Full observability with OTEL",
        description:
          "First-class OpenTelemetry support for traces and metrics out of the box. Export to multiple platforms simultaneously (e.g. Datadog, Prometheus) or your own collector. Trace every request end-to-end.",
      },
      {
        icon: "bolt",
        title: "Event-Driven Federated Subscriptions",
        description:
          "Combine GraphQL Federation with event-driven architecture. Scale subscriptions with Kafka, NATS, or SQS. Perfect for real-time, high-throughput systems.",
      },
      {
        icon: "rocket-launch",
        title: "AI-Ready with MCP Gateway",
        description:
          "Transform your API into an AI-ready interface. LLMs like ChatGPT and Claude can discover, understand, and interact with your graph securely. Granular access control through persisted operations.",
      },
      {
        icon: "shield-check",
        title: "100% Open Source (Apache 2.0)",
        description:
          "Cosmo is fully open-source with no usage restrictions. No vendor lock-in, full transparency.",
      },
    ],
  },
};

/**
 * Get signup content based on the variant
 * @param variant - The signup variant (from URL parameter)
 * @returns The content configuration for the variant
 */
export const getSignupContent = (variant: SignupVariant = "default"): SignupContent => {
  return signupContentMap[variant] || signupContentMap.default;
};

/**
 * Parse the 'uc' (use case) parameter from URL query
 * @param ucParam - The 'uc' query parameter value
 * @returns The signup variant or 'default' if not recognized
 */
export const parseSignupVariant = (ucParam?: string): SignupVariant => {
  if (ucParam === "apollo") {
    return "apollo";
  }
  return "default";
};
