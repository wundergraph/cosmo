import { cn } from "@/lib/utils";
import NextLink, { LinkProps } from "next/link";

export const Link: React.FC<
  LinkProps & { className?: string; children: React.ReactNode }
> = (props) => {
  return (
    <NextLink
      {...props}
      className={cn("opacity-90 hover:opacity-100", props.className)}
    />
  );
};
