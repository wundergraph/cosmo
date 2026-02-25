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
import { getSignupContent, type SignupVariant } from "@/lib/signup-content";

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
export const MarketingHeader = ({
  title,
  description,
}: {
  title?: string;
  description?: string;
}) => {
  const defaultTitle = "Cosmo: Open-Source\nGraphQL Federation Solution";
  const defaultDescription =
    "Unify distributed APIs into one federated graph. Platform teams get observability and control. Service teams ship independently.";

  const displayTitle = title || defaultTitle;
  const displayDescription = description || defaultDescription;

  return (
    <div className="text-center">
      <h1 className="bg-[linear-gradient(180deg,#FFFFFF_50%,#999999_100%)] bg-clip-text text-2xl font-bold leading-[130%] text-transparent sm:text-[32px]">
        {displayTitle.split("\n").map((line, index) => (
          <span key={index}>
            {line}
            {index < displayTitle.split("\n").length - 1 && <br />}
          </span>
        ))}
      </h1>
      <p className="mx-auto mt-4 max-w-md text-sm text-white/85">{displayDescription}</p>
    </div>
  );
};

/**
 * Feature Item - Individual feature with icon tile (glossy, border highlight)
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
  <div className="flex items-center gap-6">
    <div
      className="feature-icon-tile relative flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/25 bg-black/50"
      style={{
        boxShadow:
          "inset 0 0 0 1px rgba(255,255,255,0.08), inset 0 1px 0 rgba(255,255,255,0.06)",
      }}
    >
      {/* Glossy highlight (top edge) */}
      <div
        className="pointer-events-none absolute inset-0 rounded-lg"
        style={{
          background:
            "linear-gradient(165deg, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.04) 25%, transparent 50%)",
        }}
      />
      {/* Border highlight (static tilt) */}
      <div className="feature-icon-tile-border-highlight pointer-events-none absolute inset-0 rounded-lg" />
      <span className="relative z-[1]">{icon}</span>
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
export const ProductCosmoStack = ({
  variant = "login",
  signupVariant,
}: {
  variant?: "login" | "signup";
  signupVariant?: "default" | "apollo";
}) => {
  // Icon mapping function (larger icons for feature tiles)
  const getIcon = (iconName: string) => {
    const iconClass = "h-8 w-8 text-purple-400";
    switch (iconName) {
      case "bolt":
        return <BoltIcon className={iconClass} />;
      case "code-bracket":
        return <CodeBracketIcon className={iconClass} />;
      case "shield-check":
        return <ShieldCheckIcon className={iconClass} />;
      case "share":
        return <ShareIcon className={iconClass} />;
      case "magnifying-glass":
        return <MagnifyingGlassIcon className={iconClass} />;
      case "rocket-launch":
        return <RocketLaunchIcon className={iconClass} />;
      default:
        return <BoltIcon className={iconClass} />;
    }
  };

  const loginFeatures = [
    {
      icon: <BoltIcon className="h-8 w-8 text-purple-400" />,
      title: "Real time subscriptions without new infrastructure",
      description:
        "Cosmo Streams turns existing event streams into GraphQL subscriptions by handling authorization, filtering, and fan out in the Cosmo Router, keeping subgraphs stateless and avoiding a separate service.",
    },
    {
      icon: <CodeBracketIcon className="h-8 w-8 text-purple-400" />,
      title: "Extend the router with TypeScript",
      description:
        "With TypeScript plugin support in Cosmo Connect, you can extend the Cosmo Router using TypeScript and run custom logic directly inside the router, without deploying separate services.",
    },
    {
      icon: <ShieldCheckIcon className="h-8 w-8 text-purple-400" />,
      title: "Enforce custom schema rules before deploy",
      description:
        "With Subgraph Check Extensions, you can run your own validation logic as part of Cosmo's subgraph checks, enforcing custom schema rules before changes are deployed.",
    },
  ];

  // Signup content always from content map (single source of truth)
  let marketingTitle: string | undefined;
  let marketingDescription: string | undefined;
  const signupContent =
    variant === "signup" ? getSignupContent(signupVariant ?? "default") : null;
  if (signupContent) {
    marketingTitle = signupContent.marketingTitle;
    marketingDescription = signupContent.marketingDescription;
  }
  const signupFeatures =
    signupContent?.features.map((feature) => ({
      icon: getIcon(feature.icon),
      title: feature.title,
      description: feature.description,
    })) ?? [];

  const features = variant === "login" ? loginFeatures : signupFeatures;

  return (
    <div className="flex w-full flex-col px-2 sm:max-w-[43.2rem] sm:px-8">
      <MarketingHeader title={marketingTitle} description={marketingDescription} />
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
