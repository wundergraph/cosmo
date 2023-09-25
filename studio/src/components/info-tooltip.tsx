import { FiInfo } from "react-icons/fi";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { TooltipArrow } from "@radix-ui/react-tooltip";

export interface InfoTooltipProps {
  children: React.ReactNode;
}

export const InfoTooltip: React.FC<InfoTooltipProps> = (props) => {
  const { children } = props;
  return (
    <Tooltip>
      <TooltipTrigger>
        <span>
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
