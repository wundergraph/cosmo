import clsx from "clsx";

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
    <div className="flex h-screen flex-col">
      <div className="bg-background">
        <div
          className={clsx(
            "flex flex-col justify-between gap-y-4 px-4 pb-2 pt-6 lg:flex-row lg:items-center lg:px-8",
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
      <div className="h-auto flex-1 overflow-y-auto px-4 py-4 lg:px-8">
        {children}
      </div>
    </div>
  );
};
