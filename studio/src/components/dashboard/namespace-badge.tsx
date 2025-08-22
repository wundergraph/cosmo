import Link from "next/link";
import * as React from "react";
import { cn } from "@/lib/utils";
import { useRouter } from "next/router";
import { useMemo } from "react";

export interface NamespaceBadgeProps {
  value: string;
  setNamespace(namespace: string): void;
  className?: string;
}

export function NamespaceBadge({ value, setNamespace, className }: NamespaceBadgeProps) {
  const router = useRouter();
  const { organizationSlug } = router.query;
  const pathname = useMemo(
    () => router.pathname.split('/').length === 3 ? router.pathname : '/[organizationSlug]/graphs',
    [router.pathname]
  );

  return (
    <Link
      href={{
        pathname,
        query: { organizationSlug, namespace: value },
      }}
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