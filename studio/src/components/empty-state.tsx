import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  eyebrow?: string;
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** @deprecated Use children instead */
  actions?: React.ReactNode;
  children?: React.ReactNode;
  secondaryAction?: { label: string; href: string };
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  eyebrow,
  icon,
  title,
  description,
  actions,
  children,
  secondaryAction,
  className,
}) => {
  const content = children ?? actions;

  return (
    <div className={cn('flex w-full flex-col items-center justify-center px-6 py-16 text-center', className)}>
      <div className="mx-auto flex w-full max-w-2xl flex-col items-center">
        {icon && (
          <span className="mb-4 flex h-12 w-12 items-center justify-center text-muted-foreground">
            {icon}
          </span>
        )}
        {eyebrow && (
          <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            {eyebrow}
          </p>
        )}
        <h3 className="mb-2 text-2xl font-semibold text-foreground">{title}</h3>
        {description && (
          <p className="mx-auto mb-6 max-w-md break-words text-center text-sm text-muted-foreground">
            {description}
          </p>
        )}
        {content && <div className="w-full">{content}</div>}
        {secondaryAction && (
          <div className="mt-8 w-full max-w-md border-t pt-4">
            <a
              href={secondaryAction.href}
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between text-sm text-muted-foreground hover:text-foreground"
            >
              <span>{secondaryAction.label}</span>
              <span aria-hidden="true">→</span>
            </a>
          </div>
        )}
      </div>
    </div>
  );
};
