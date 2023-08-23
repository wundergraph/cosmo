import * as React from "react";
import {
  differenceInSeconds,
  format,
  formatDistanceToNowStrict,
} from "date-fns";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "./ui/tooltip";

export interface TimeAgoProps {
  date: Date | number;
  suffix?: boolean;
  tooltip?: boolean;
}

const formatTimeAgo = (date: Date | number, suffix?: boolean) => {
  const diff = differenceInSeconds(new Date(), date);

  if (diff < 60) {
    return "just now";
  }

  return formatDistanceToNowStrict(date, {
    addSuffix: suffix,
    roundingMethod: "floor",
  });
};

export const TimeAgo: React.FC<TimeAgoProps> = (props) => {
  const { date, suffix = true, tooltip = true } = props;

  const [timeAgo, setTimeAgo] = React.useState(formatTimeAgo(date, suffix));

  React.useEffect(() => {
    const diff = differenceInSeconds(new Date(), date);
    let interval: any = null;
    if (diff < 600) {
      interval = setInterval(() => {
        setTimeAgo(formatTimeAgo(date, suffix));
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [date, suffix]);

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger>{timeAgo}</TooltipTrigger>
          <TooltipContent>{format(date, "P p")}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <>{timeAgo}</>;
};
