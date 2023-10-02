import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getCalApi } from "@calcom/embed-react";

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

let cal: Awaited<ReturnType<typeof getCalApi>>;
export const showCal = async (e: any) => {
  e.preventDefault();
  if (!cal) {
    cal = await getCalApi();
  }
  cal("modal", {
    calLink: "stefan-avram-wundergraph/wundergraph-introduction",
  });
};
