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
    description: "Try Cosmo managed and migrate from Apollo GraphOS in minutes. No credit card required.",
    marketingTitle: "Migrate to Cosmo\nfrom Apollo GraphOS",
    marketingDescription:
      "Escape the vendor lock. 100% open source GraphQL Federation with full control. A drop-in GraphOS replacement.",
    features: [
      {
        icon: "code-bracket",
        title: "Schema design and governance as it should be",
        description:
          "Get linting, breaking-change detection, schema contracts, and PR-based checks from day one. Cosmo doesn't gate governance behind tiers.",
      },
      {
        icon: "rocket-launch",
        title: "Cosmo delivers value, not traffic bills",
        description:
          "Enjoy predictable, transparent pricing for what drives value in your organization, as well as world-class support.",
      },
      {
        icon: "share",
        title: "Connect legacy services without a proprietary lock-in",
        description:
          "Wrap REST, gRPC, SOAP and other existing APIs into your supergraph without rewriting backends. No schema changes required.",
      },
      {
        icon: "bolt",
        title: "Build real-time event-driven subscriptions that scale",
        description:
          "Turn Kafka, NATS, or Redis into GraphQL subscriptions. Subgraphs stay stateless. Scale to tens of thousands of clients effortlessly.",
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
  if (ucParam?.toLowerCase() === "apollo") {
    return "apollo";
  }
  return "default";
};
