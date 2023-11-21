import { FiInfo } from "react-icons/fi";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipArrow,
} from "./ui/tooltip";

export interface InfoTooltipProps {
  children: React.ReactNode;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = (props) => {
  const { children } = props;
  return (
    <Tooltip delayDuration={50}>
      <TooltipTrigger asChild>
        <span className="text-sm text-muted-foreground">
          <FiInfo />
        </span>
      </TooltipTrigger>

      <TooltipContent>
        <TooltipArrow />
        {children}
      </TooltipContent>
    </Tooltip>
  );
};
