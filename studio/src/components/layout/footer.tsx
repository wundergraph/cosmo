import Link from "next/link";
import { Logo } from "../logo";

export const Footer = () => {
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
      href: "https://wundergraph.com/cookies",
      label: "Cookie Policy",
    },
  ];

  return (
    <footer className="border-t border-gray-800 bg-gray-950/80 px-4 text-gray-400 xl:px-0">
      <div className="mx-auto max-w-screen-xl py-8">
        <div className="flex flex-col items-start space-y-4">
          <nav className="flex flex-col gap-y-2 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6 sm:gap-y-2">
            <div className="flex items-center">
              <Logo width={24} height={24} />
            </div>
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
          </nav>

          <div className="text-sm">
            © {currentYear} WunderGraph, Inc. All rights reserved.
          </div>
        </div>
      </div>
    </footer>
  );
};
