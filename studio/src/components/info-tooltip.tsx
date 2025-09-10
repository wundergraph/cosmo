import { FiInfo } from "react-icons/fi";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipArrow,
} from "./ui/tooltip";
import { cn } from "@/lib/utils";

export interface InfoTooltipProps {
  children: React.ReactNode;
  tooltipTriggerClassName?: string;
  tooltipContentClassName?: string;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = (props) => {
  const { children } = props;
  return (
    <Tooltip delayDuration={50}>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "text-sm text-muted-foreground",
            props.tooltipTriggerClassName,
          )}
        >
          <FiInfo />
        </span>
      </TooltipTrigger>

      <TooltipContent className={cn(props.tooltipContentClassName)}>
        <TooltipArrow />
        {children}
      </TooltipContent>
    </Tooltip>
  );
};
