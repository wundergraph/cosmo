import { cn } from "@/lib/utils";

export interface EmptyStateProps {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = (props) => {
  const { icon, title, description, actions, className } = props;

  return (
    <div
      className={cn(
        "flex h-[520px] w-full items-center justify-center rounded-md",
        className
      )}
    >
      <div className="mx-auto flex w-full flex-col items-center justify-center px-6 text-center md:max-w-2xl">
        <span className="m-auto flex h-12 w-12 items-center justify-center text-6xl text-muted-foreground">
          {icon}
        </span>
        <h3 className="mt-4 text-lg font-semibold">{title}</h3>
        <p className="mb-4 mt-2 break-words text-sm text-muted-foreground">
          {description}
        </p>
        <div className="mb-4 flex w-full justify-center">{actions}</div>
      </div>
    </div>
  );
};
