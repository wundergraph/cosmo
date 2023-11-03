import { Button, ButtonProps } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import useWindowSize from "@/hooks/use-window-size";
import { formatDate } from "@/lib/format-date";
import { cn } from "@/lib/utils";
import CalendarIcon from "@heroicons/react/24/outline/CalendarIcon";
import { addDays, addYears, subHours } from "date-fns";
import { useEffect, useState } from "react";
import { Input } from "./ui/input";

const ranges = {
  1: "Last hour",
  4: "Last 4 hours",
  24: "Last day",
  72: "Last 3 days",
  168: "Last week",
  720: "Last month",
} as const;

export type Range = keyof typeof ranges;

export const getRange = (range?: string | number): Range => {
  return range && Number(range) in ranges
    ? (Number(range) as Range)
    : defaultRange;
};

const defaultRange = 24;

export type DateRange = {
  start: Date;
  end?: Date;
};

const getFromDate = (from: Date, time = "00:00") => {
  const [hours, minutes] = time.split(":").map((str) => parseInt(str, 10));
  return new Date(
    from.getFullYear(),
    from.getMonth(),
    from.getDate(),
    hours,
    minutes
  );
};

const getToDate = (to: Date, time = "23:59") => {
  const [hours, minutes] = time.split(":").map((str) => parseInt(str, 10));
  return new Date(
    to.getFullYear(),
    to.getMonth(),
    to.getDate(),
    hours,
    minutes
  );
};

const getFormattedTime = (date: Date) => {
  return (
    date.getHours().toString().padStart(2, "0") +
    ":" +
    date.getMinutes().toString().padStart(2, "0")
  );
};

export type DateRangePickerChangeHandler = (newVal: {
  dateRange?: DateRange;
  range?: Range;
}) => void;

export function DatePickerWithRange({
  range,
  dateRange,
  onChange,
  onCancel,
  className,
  align = "start",
  size,
}: Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> & {
  range?: Range;
  dateRange: DateRange;
  onChange: DateRangePickerChangeHandler;
  onCancel?: () => void;
  align?: "start" | "center" | "end";
  size?: ButtonProps["size"];
}) {
  const { isMobile } = useWindowSize();

  const [selected, setSelectedDateRange] = useState(dateRange);
  const [selectedRange, setSelectedRange] = useState(range);
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");

  const setTime = (field: "start" | "end", time: string) => {
    if (field === "start") {
      setStartTime(time);
    } else {
      setEndTime(time);
    }
  };

  const [isOpen, setIsOpen] = useState(false);

  const rangeLabel = range ? ranges[range] : undefined;

  const reset = () => {
    setSelectedRange(range);
    if (!range) {
      setStartTime(getFormattedTime(dateRange.start));
      setEndTime(dateRange.end ? getFormattedTime(dateRange.end) : "");
    } else {
      const end = new Date();
      setStartTime(getFormattedTime(subHours(end, range)));
      setEndTime(getFormattedTime(end));
    }
    if (dateRange) {
      setSelectedDateTime(dateRange, undefined, false);
    }
  };

  useEffect(() => {
    reset();
  }, [range, dateRange]);

  const setSelectedDateTime = (
    { start, end }: { start: Date; end?: Date },
    { startTime, endTime }: { startTime?: string; endTime?: string } = {},
    resetRange = true
  ) => {
    const dateRange = {
      start: getFromDate(start, startTime || getFormattedTime(start)),
      end: end && getToDate(end, endTime || getFormattedTime(end)),
    };

    setSelectedDateRange(dateRange);

    if (resetRange) {
      setSelectedRange(undefined);
    }
  };

  const getValue = (): DateRange => {
    return {
      start: getFromDate(
        selected.start,
        startTime === "" ? "00:00" : startTime
      ),
      end:
        selected?.end &&
        getToDate(selected.end, endTime === "" ? "23:59" : endTime),
    };
  };

  const onRangeClick = (range: Range) => {
    const start = subHours(new Date(), range);
    const end = new Date();

    setStartTime(getFormattedTime(start));
    setEndTime(getFormattedTime(end));

    setSelectedRange(range);
    setSelectedDateRange({ start, end });
  };

  const handleTimeChange =
    (field: "start" | "end"): React.ChangeEventHandler<HTMLInputElement> =>
    (e) => {
      const time = e.target.value;
      setTime(field, time);
      if (time) {
        // if time is set, then we need to reset the range to 'custom'
        setSelectedRange(undefined);
      }
    };

  return (
    <Popover
      open={isOpen}
      onOpenChange={(open) => {
        setIsOpen(open);
        reset();
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id="date"
          variant={"outline"}
          size={size}
          className={cn(
            "w-[200px] justify-start px-2.5 text-left font-normal",
            className,
            !selected && "text-muted-foreground"
          )}
        >
          <CalendarIcon className="mr-2 h-4 w-4" />

          <span className="truncate text-sm">
            {rangeLabel ? (
              rangeLabel
            ) : dateRange?.start ? (
              dateRange.end ? (
                <>
                  {formatDate(dateRange.start)} - {formatDate(dateRange.end)}
                </>
              ) : (
                <>{formatDate(dateRange.start)} - </>
              )
            ) : (
              <>Pick a date</>
            )}
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="flex w-auto flex-col p-0" align={align}>
        <div className="flex">
          <ul className="w-[140px] space-y-[1px] border-r p-2">
            {Object.entries(ranges).map(([id, label]) => (
              <li key={id}>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  data-active={selectedRange === Number(id) ? "" : undefined}
                  onClick={() => onRangeClick(Number(id) as Range)}
                >
                  {label}
                </Button>
              </li>
            ))}
            <li>
              <Button
                variant="ghost"
                className="w-full justify-start"
                data-active={!selectedRange ? "" : undefined}
                onClick={() => {
                  setSelectedRange(undefined);
                  setStartTime("00:00");
                  setEndTime("23:59");
                }}
              >
                Custom
              </Button>
            </li>
          </ul>
          <div>
            <Calendar
              initialFocus
              mode="range"
              defaultMonth={selected?.start}
              selected={{
                from: selected?.start,
                to: selected?.end,
              }}
              onSelect={(range, day) => {
                if (range) {
                  setStartTime(range.from ? "00:00" : "");
                  setEndTime(range.to ? "23:59" : "");

                  if (selected?.start && selected?.end) {
                    setSelectedDateRange({ start: day, end: undefined });
                    return;
                  }

                  setSelectedDateRange({
                    start: range.from!,
                    end: range.to,
                  });
                  setSelectedRange(undefined);
                }
              }}
              min={2}
              numberOfMonths={isMobile ? 1 : 2}
              showOutsideDays={false}
              disabled={[
                {
                  from: addDays(new Date(), 1),
                  to: addYears(new Date(), 1000),
                },
              ]}
            />
            <div className="grid grid-cols-2 gap-4 px-4 py-2 text-sm">
              <p>
                <label>
                  Start time
                  <Input
                    className="mt-1"
                    type="time"
                    value={startTime}
                    onChange={handleTimeChange("start")}
                  />
                </label>
              </p>
              <p>
                <label>
                  End time
                  <Input
                    className="mt-1"
                    type="time"
                    value={endTime}
                    onChange={handleTimeChange("end")}
                  />
                </label>
              </p>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t px-4 py-2">
          <Button
            variant="ghost"
            onClick={() => {
              setIsOpen(false);
              onCancel?.();
            }}
          >
            Cancel
          </Button>
          <Button
            variant="default"
            onClick={() => {
              setIsOpen(false);

              const dateRange = getValue();

              setSelectedDateRange(dateRange);

              onChange?.({
                range: selectedRange,
                dateRange,
              });
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
