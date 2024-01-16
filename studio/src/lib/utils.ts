import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
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

export const capitalize = (str: string) => {
  return str.charAt(0).toUpperCase() + str.slice(1);
};

export const getHighestPriorityRole = ({
  userRoles,
}: {
  userRoles: string[];
}) => {
  if (userRoles.includes("admin")) {
    return "admin";
  }
  if (userRoles.includes("developer")) {
    return "developer";
  }
  return "viewer";
};
