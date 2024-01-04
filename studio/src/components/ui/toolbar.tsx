import { cn } from "@/lib/utils";
import React from "react";

export const Toolbar = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => {
  return (
    <div
      className={cn(
        "flex w-full flex-shrink-0 flex-wrap items-center gap-2 px-4 lg:px-6 xl:px-8",
        className,
      )}
    >
      {children}
    </div>
  );
};
