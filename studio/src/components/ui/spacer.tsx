import { cn } from "@/lib/utils";

export const Spacer = ({ className }: { className?: string }) => {
  return <div className={cn("flex-1", className)} />;
};
