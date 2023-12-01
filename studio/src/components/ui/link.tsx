import { cn } from "@/lib/utils";
import NextLink, { LinkProps } from "next/link";
import { forwardRef } from "react";

export const Link = forwardRef<
  HTMLAnchorElement,
  LinkProps & { className?: string; children: React.ReactNode }
>((props, ref) => {
  return (
    <NextLink
      ref={ref}
      {...props}
      className={cn("opacity-90 hover:opacity-100", props.className)}
    />
  );
});

Link.displayName = "Link";
