import { cva, type VariantProps } from "class-variance-authority";

import { Badge } from "../ui/badge";
import { FiArrowDown, FiArrowRight, FiArrowUp } from "react-icons/fi";
import { cn } from "@/lib/utils";

const deltaBadgeVariants = cva(
  "inline-flex items-center gap-2 rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      type: {
        neutral: "border-transparent bg-muted text-muted-foreground",
        "increase-positive": "border-transparent bg-success/10 text-success",
        "increase-negative":
          "border-transparent bg-destructive/10 text-destructive",
        "decrease-positive": "border-transparent bg-success/10 text-success",
        "decrease-negative":
          "border-transparent bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      type: "neutral",
    },
  }
);

export interface DeltaBadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof deltaBadgeVariants> {
  value: string;
}

export const DeltaBadge: React.FC<DeltaBadgeProps> = (props) => {
  const { type, className, ...rest } = props;
  return (
    <Badge
      variant="plain"
      className={cn(deltaBadgeVariants({ type }), className)}
      {...rest}
    >
      {props.type === "neutral" ? (
        <FiArrowRight />
      ) : props.type?.match("increase") ? (
        <FiArrowUp />
      ) : (
        <FiArrowDown />
      )}
      {props.value}
    </Badge>
  );
};
