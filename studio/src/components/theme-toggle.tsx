import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
} from "@/components/ui/dropdown-menu";
import { DropdownMenuSubTrigger } from "@radix-ui/react-dropdown-menu";
import { ChevronRightIcon, MoonIcon, SunIcon } from "@radix-ui/react-icons";
import { useTheme } from "next-themes";

const modes: Record<string, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

export function ThemeToggle() {
  const { setTheme, theme } = useTheme();

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger asChild>
        <DropdownMenuItem>
          {theme === "dark" ? (
            <MoonIcon className="mr-2 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          ) : (
            <SunIcon className="mr-2 h-[0.75rem] w-[0.75rem] rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          )}
          {modes[theme || "system"]}
          <span className="ml-auto">
            <ChevronRightIcon className="h-4 w-4" />
          </span>
        </DropdownMenuItem>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <DropdownMenuItem onClick={() => setTheme("light")}>
          Light
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("dark")}>
          Dark
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme("system")}>
          System
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
