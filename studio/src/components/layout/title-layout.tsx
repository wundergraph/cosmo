import { Separator } from "../ui/separator";

export const TitleLayout = ({
  title,
  subtitle,
  items,
  toolbar,
  children,
}: {
  title: string;
  subtitle: string;
  items?: React.ReactNode;
  toolbar?: React.ReactNode;
  children?: React.ReactNode;
}) => {
  return (
    <div className="flex h-full flex-col">
      <div className="sticky top-0 z-10 bg-background">
        <div className="flex flex-col justify-between gap-y-4 px-4 pt-4 lg:flex-row lg:items-center lg:px-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-muted-foreground">{subtitle}</p>
          </div>
          {items}
        </div>
        <Separator className="mt-4" />
        {toolbar ? (
          <div className="px-4 py-2 lg:px-6 lg:py-4">{toolbar}</div>
        ) : null}
      </div>
      <div className="h-auto flex-1 px-4 py-4 lg:px-6">{children}</div>
    </div>
  );
};
