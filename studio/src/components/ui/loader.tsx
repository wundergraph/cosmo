import { cn } from "@/lib/utils";
import * as React from "react";
import { HTMLAttributes } from "react";

interface LoaderProps extends HTMLAttributes<HTMLSpanElement> {
  fullscreen?: boolean;
}

const Loader = React.forwardRef<HTMLSpanElement, LoaderProps>(
  ({ fullscreen, className, ...props }, ref) => {
    return (
      <div
        className={cn("flex items-center justify-center", {
          "h-full flex-1": fullscreen,
        })}
      >
        <span className={cn("loader", className)} {...props}></span>
      </div>
    );
  }
);

Loader.displayName = "Loader";

export { Loader };
