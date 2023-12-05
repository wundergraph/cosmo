import { useLocalStorage } from "@/hooks/use-local-storage";
import { cn } from "@/lib/utils";

export interface TitleLayoutProps {
  title: React.ReactNode;
  subtitle: string;
  items?: React.ReactNode;
  toolbar?: React.ReactNode;
  noPadding?: boolean;
  children?: React.ReactNode;
}

export const TitleLayout = ({
  title,
  subtitle,
  items,
  toolbar,
  noPadding,
  children,
}: TitleLayoutProps) => {
  const [disableStarBanner] = useLocalStorage("disableStarBanner", "false");

  return (
    <div
      className={cn("flex flex-col", {
        "h-[calc(100vh-32px)]": disableStarBanner === "false",
        "h-screen": disableStarBanner !== "false",
      })}
    >
      <div className="bg-background">
        <div
          className={cn(
            "flex flex-col justify-between gap-y-4 px-4 pb-2 pt-4 lg:flex-row lg:items-center lg:px-8",
            {
              "border-b": !toolbar,
              "pb-6": !toolbar,
            },
          )}
        >
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
          {items}
        </div>
        {toolbar}
      </div>
      <div
        className={cn(
          "h-auto flex-1 overflow-y-auto",
          noPadding !== true && "px-4 py-4 lg:px-8 lg:py-6",
        )}
      >
        {children}
      </div>
    </div>
  );
};
