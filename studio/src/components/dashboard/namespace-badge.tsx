import Link from "next/link";
import * as React from "react";
import { useCurrentOrganization } from "@/hooks/use-current-organization";
import { cn } from "@/lib/utils";

export interface NamespaceBadgeProps {
  value: string;
  setNamespace(namespace: string): void;
  className?: string;
}

export function NamespaceBadge({ value, setNamespace, className }: NamespaceBadgeProps) {
  const currentOrg = useCurrentOrganization();

  return (
    <Link
      href={`/${currentOrg?.slug}/graphs?namespace=${value}`}
      className={cn(
        "bg-primary/15 hover:bg-primary/30 text-primary transition-colors duration-150 px-3 py-1 rounded-lg text-sm flex-shrink-0 max-w-[180px] lg:max-w-sm truncate",
        className,
      )}
      onClick={() => setNamespace(value)}
    >
      {value}
    </Link>
  );
}