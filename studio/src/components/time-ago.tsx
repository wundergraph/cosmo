import * as React from 'react';
import { differenceInSeconds, format, formatDistanceToNowStrict } from 'date-fns';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

export interface TimeAgoProps {
  date: Date | number;
  suffix?: boolean;
  tooltip?: boolean;
  compact?: boolean;
}

const formatTimeAgo = (date: Date | number, suffix?: boolean, compact?: boolean) => {
  const diff = differenceInSeconds(new Date(), date);

  if (diff < 60) {
    return 'just now';
  }

  if (compact) {
    const minutes = Math.floor(diff / 60);
    const hours = Math.floor(diff / (60 * 60));
    const days = Math.floor(diff / (60 * 60 * 24));
    const months = Math.floor(diff / (60 * 60 * 24 * 30));
    const years = Math.floor(diff / (60 * 60 * 24 * 365));

    let value: number;
    let unit: string;

    if (years >= 1) {
      value = years;
      unit = 'y';
    } else if (months >= 1) {
      value = months;
      unit = 'mo';
    } else if (days >= 1) {
      value = days;
      unit = 'd';
    } else if (hours >= 1) {
      value = hours;
      unit = 'h';
    } else {
      value = minutes;
      unit = 'm';
    }

    return suffix ? `${value}${unit} ago` : `${value}${unit}`;
  }

  return formatDistanceToNowStrict(date, {
    addSuffix: suffix,
    roundingMethod: 'floor',
  });
};

export const TimeAgo: React.FC<TimeAgoProps> = (props) => {
  const { date, suffix = true, tooltip = true, compact = false } = props;

  const [timeAgo, setTimeAgo] = React.useState(formatTimeAgo(date, suffix, compact));

  React.useEffect(() => {
    const diff = differenceInSeconds(new Date(), date);
    let interval: any = null;
    if (diff < 600) {
      interval = setInterval(() => {
        setTimeAgo(formatTimeAgo(date, suffix, compact));
      }, 1000);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [date, suffix, compact]);

  if (tooltip) {
    return (
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger>{timeAgo}</TooltipTrigger>
          <TooltipContent>{format(date, 'P p')}</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return <>{timeAgo}</>;
};
