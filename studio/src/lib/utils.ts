import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatNumber = (number: number) => {
  if (number === 0) {
    return "0";
  }

  const suffixes = ["", "K", "M", "B", "T"];
  const suffixIndex = Math.floor(Math.log10(Math.abs(number)) / 3);
  const formattedNumber = number / Math.pow(10, suffixIndex * 3);

  if (Number.isInteger(formattedNumber)) {
    return formattedNumber.toFixed(0) + suffixes[suffixIndex];
  }

  return formattedNumber.toFixed(1) + suffixes[suffixIndex];
};
