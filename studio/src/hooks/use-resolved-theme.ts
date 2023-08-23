import { useTheme } from "next-themes";
import { useMemo } from "react";

export const useResolvedTheme = () => {
  const { theme, systemTheme } = useTheme();

  const selectedTheme = useMemo(() => {
    return theme !== "system" ? theme : systemTheme;
  }, [theme, systemTheme]);

  return selectedTheme;
};
