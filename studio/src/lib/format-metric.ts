import { formatNumber } from "./format-number";

export const formatMetric = (
  number: number,
  options?: Intl.NumberFormatOptions
) => {
  if (number === 0) {
    return "0";
  }

  if (number <= 1000) {
    return formatNumber(number, options);
  }

  const suffixes = ["", "K", "M", "B", "T"];
  const suffixIndex = Math.floor(Math.log10(Math.abs(number)) / 3);
  const formattedNumber = number / Math.pow(10, suffixIndex * 3);

  return (
    formatNumber(formattedNumber, {
      maximumFractionDigits: 1,
    }) + suffixes[suffixIndex]
  );
};

export const formatDurationMetric = (
  number: number,
  options?: Intl.NumberFormatOptions
) => {
  if (number === 0) {
    return "0";
  }

  let unit = "millisecond";
  let formattedNumber = number;
  if (number >= 60 * 1000) {
    unit = "minute";
    formattedNumber = number / (60 * 1000);
  } else if (number >= 1000) {
    unit = "second";
    formattedNumber = number / 1000;
  }

  const _options: Intl.NumberFormatOptions = {
    style: "unit",
    unit,
    ...options,
  };

  return formatNumber(formattedNumber, _options);
};

export const formatPercentMetric = (
  number: number,
  options?: Intl.NumberFormatOptions
) => {
  const _options: Intl.NumberFormatOptions = {
    style: "unit",
    unit: "percent",
    maximumFractionDigits: 2,
    ...options,
  };

  return formatNumber(number, _options);
};
