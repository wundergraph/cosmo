import { LintConfig } from "@wundergraph/cosmo-connect/dist/platform/v1/platform_pb";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { lintCategories } from "./constants";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function clamp(value: number, min: number, max: number): number {
  const result = Math.min(Math.max(value, min), max);
  return Number.isNaN(result) ? min : result;
}

export function distinctBy<T, TKey>(source: T[], keySelector: (item: T) => TKey) {
  const keys = new Set<TKey>();
  return source.filter((item) => {
    const key = keySelector(item);
    if (keys.has(key)) {
      return false;
    }

    keys.add(key);
    return true;
  });
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

export const countLintConfigsByCategory = (lintConfigs: LintConfig[]) => {
  let countNamingConventionRules = 0;
  let countAlphabeticalSortRules = 0;
  let countOtherRules = 0;

  const namingConventionRules = lintCategories[0].rules.map((l) => l.name);
  const alphabeticalSortRules = lintCategories[1].rules.map((l) => l.name);
  const otherRules = lintCategories[2].rules.map((l) => l.name);

  for (const l of lintConfigs) {
    if (namingConventionRules.includes(l.ruleName)) {
      countNamingConventionRules += 1;
    } else if (alphabeticalSortRules.includes(l.ruleName)) {
      countAlphabeticalSortRules += 1;
    } else if (otherRules.includes(l.ruleName)) {
      countOtherRules += 1;
    }
  }

  return [
    countNamingConventionRules,
    countAlphabeticalSortRules,
    countOtherRules,
  ];
};