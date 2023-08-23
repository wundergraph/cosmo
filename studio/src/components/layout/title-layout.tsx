import { Separator } from "../ui/separator";

export const TitleLayout = ({
  title,
  subtitle,
  items,
  children,
}: {
  title: string;
  subtitle: string;
  items?: React.ReactNode;
  children?: React.ReactNode;
}) => {
  return (
    <>
      <div className="sticky top-0 z-10 bg-background">
        <div className="flex flex-col justify-between gap-y-4 px-4 pt-4 lg:flex-row lg:items-center lg:px-6">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold">{title}</h1>
            <p className="text-muted-foreground">{subtitle}</p>
          </div>
          {items}
        </div>
        <Separator className="mt-4" />
      </div>
      <div className="h-[calc(100vh_-_15rem)] flex-1 px-4 py-4 lg:h-[calc(100%_-_98px)] lg:px-6">
        {children}
      </div>
    </>
  );
};
