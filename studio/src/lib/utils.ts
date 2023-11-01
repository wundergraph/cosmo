import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { getCalApi } from "@calcom/embed-react";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

export const checkUserAccess = ({
  rolesToBe,
  userRoles,
}: {
  rolesToBe: string[];
  userRoles: string[];
}) => {
  for (const role of rolesToBe) {
    if (userRoles.includes(role)) {
      return true;
    }
  }
  return false;
};
