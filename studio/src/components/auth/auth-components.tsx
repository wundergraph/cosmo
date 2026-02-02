import { cn } from "@/lib/utils";
import Image from "next/image";
import Link from "next/link";
import { Logo } from "../logo";
import { ReactNode } from "react";
import {
  BoltIcon,
  CodeBracketIcon,
  ShieldCheckIcon,
  ShareIcon,
  MagnifyingGlassIcon,
  RocketLaunchIcon,
} from "@heroicons/react/24/outline";

/**
 * Auth Card - The card container for auth forms
 */
export interface AuthCardProps {
  children: ReactNode;
  className?: string;
}

export const AuthCard = ({ children, className }: AuthCardProps) => {
  return (
    <div
      className={cn(
        "flex w-full flex-col rounded-xl border border-[#FFFFFF1A] bg-[#08040CBF] backdrop-blur-xl",
        className
      )}
    >
      {children}
    </div>
  );
};

/**
 * Auth Logo Header - WunderGraph Cosmo logo with text
 */
export const AuthLogoHeader = () => {
  return (
    <a href="https://wundergraph.com" className="flex items-center gap-2 text-white">
      <Logo width={48} height={48} />
      <span className="text-base font-semibold lg:text-lg">
        WunderGraph Cosmo
      </span>
    </a>
  );
};

/**
 * Auth Footer - Footer with links for auth pages
 * Height: 65px / 900px = 7.2%
 */
export const AuthFooter = () => {
  const currentYear = new Date().getFullYear();

  const footerLinks = [
    {
      href: "https://wundergraph.com/privacy-policy",
      label: "Privacy Policy",
    },
    {
      href: "https://trust.wundergraph.com/",
      label: "Trust Center",
    },
    {
      href: "https://wundergraph.com/terms",
      label: "Website Terms of Use",
    },
    {
      href: "https://wundergraph.com/cosmo-managed-service-terms",
      label: "Cosmo Managed Service Terms",
    },
    {
      href: "https://wundergraph.com/pricing",
      label: "Pricing",
    },
  ];

  return (
    <footer className="flex w-full flex-shrink-0 items-center justify-center bg-black/10 px-6 py-6 text-center">
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-gray-500 lg:gap-x-6 lg:text-sm">
        {footerLinks.map((link, index) => (
          <Link
            key={index}
            href={link.href}
            className="transition-colors hover:text-white"
            target="_blank"
            rel="noopener noreferrer"
          >
            {link.label}
          </Link>
        ))}
        <div>© {currentYear} WunderGraph, Inc. All rights reserved.</div>
      </nav>
    </footer>
  );
};

/**
 * Trusted Companies - "Trusted by companies like:" section with logos
 */
export const TrustedCompanies = () => {
  const companies = [
    { name: "Shutterstock", logo: "https://wundergraph.com/images/logos/shutterstock.svg", width: 120, height: 24 },
    { name: "eBay", logo: "https://wundergraph.com/images/logos/ebay.svg", width: 60, height: 24 },
    { name: "SoundCloud", logo: "https://wundergraph.com/images/logos/soundcloud.svg", width: 120, height: 24 },
  ];

  return (
    <div className="flex flex-col items-center gap-y-6 px-4 lg:gap-y-8 lg:px-0">
      <p className="text-center text-sm text-white/65">Trusted by platform teams managing complex API ecosystems</p>
      <div className="flex items-center justify-center gap-x-5 lg:gap-x-20">
        {companies.map((company) => (
          <Image
            key={company.name}
            src={company.logo}
            alt={company.name}
            width={company.width}
            height={company.height}
            className="h-4 w-auto brightness-0 invert lg:h-5"
          />
        ))}
      </div>
    </div>
  );
};

/**
 * Marketing Header - Title and description for the right side
 */
export const MarketingHeader = () => {
  return (
    <div className="text-center">
      <h1 className="bg-[linear-gradient(180deg,#FFFFFF_50%,#999999_100%)] bg-clip-text text-2xl font-bold leading-[130%] text-transparent sm:text-[32px]">
        Cosmo: Open-Source
        <br />
        GraphQL Federation Solution
      </h1>
      <p className="mx-auto mt-4 max-w-md text-sm text-white/85">
        Unify distributed APIs into one federated graph. Platform teams get observability and control. Service teams ship independently.
      </p>
    </div>
  );
};

/**
 * Feature Item - Individual feature with icon box
 */
const FeatureItem = ({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) => (
  <div className="flex gap-4">
    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white/10">
      {icon}
    </div>
    <div>
      <h4 className="text-lg font-semibold text-white">{title}</h4>
      <p className="mt-2 text-sm text-white/85">{description}</p>
    </div>
  </div>
);

/**
 * Product Cosmo Stack - Marketing content with features list
 */
export const ProductCosmoStack = ({ variant = "login" }: { variant?: "login" | "signup" }) => {
  const loginFeatures = [
    {
      icon: <BoltIcon className="h-6 w-6 text-purple-500" />,
      title: "Real time subscriptions without new infrastructure",
      description:
        "Cosmo Streams turns existing event streams into GraphQL subscriptions by handling authorization, filtering, and fan out in the Cosmo Router, keeping subgraphs stateless and avoiding a separate service.",
    },
    {
      icon: <CodeBracketIcon className="h-6 w-6 text-purple-500" />,
      title: "Extend the router with TypeScript",
      description:
        "With TypeScript plugin support in Cosmo Connect, you can extend the Cosmo Router using TypeScript and run custom logic directly inside the router, without deploying separate services.",
    },
    {
      icon: <ShieldCheckIcon className="h-6 w-6 text-purple-500" />,
      title: "Enforce custom schema rules before deploy",
      description:
        "With Subgraph Check Extensions, you can run your own validation logic as part of Cosmo's subgraph checks, enforcing custom schema rules before changes are deployed.",
    },
  ];

  const signupFeatures = [
    {
      icon: <ShareIcon className="h-6 w-6 text-purple-500" />,
      title: "Federate Any API, Not Just GraphQL",
      description:
        "Connect REST, gRPC, and GraphQL services without rewrites. Cosmo Connect wraps existing APIs into your graph without forcing migrations.",
    },
    {
      icon: <MagnifyingGlassIcon className="h-6 w-6 text-purple-500" />,
      title: "Track Every Query Across Your Entire Graph",
      description:
        "Native OpenTelemetry tracing from gateway to subgraph. Find slow queries and failing services in seconds with zero instrumentation required.",
    },
    {
      icon: <ShieldCheckIcon className="h-6 w-6 text-purple-500" />,
      title: "Catch Breaking Changes Before Deployment",
      description:
        "Schema checks run automatically in CI/CD. Service teams ship on their own schedule, while platform teams prevent breaking changes from reaching production.",
    },
    {
      icon: <RocketLaunchIcon className="h-6 w-6 text-purple-500" />,
      title: "Built for Scale and Performance",
      description:
        "Go router with sub-millisecond overhead. Deploy with built-in caching, rate limiting, and security controls wherever your infrastructure lives.",
    },
  ];

  const features = variant === "login" ? loginFeatures : signupFeatures;

  return (
    <div className="flex w-full flex-col px-2 sm:max-w-[43.2rem] sm:px-8">
      <MarketingHeader />
      <div className="mt-10 flex flex-col gap-6">
        {features.map((feature, index) => (
          <FeatureItem
            key={index}
            icon={feature.icon}
            title={feature.title}
            description={feature.description}
          />
        ))}
      </div>
    </div>
  );
};
