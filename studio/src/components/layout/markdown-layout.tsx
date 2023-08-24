export interface LayoutProps {
  children?: React.ReactNode;
}

export const MarkdownLayout = ({ children }: LayoutProps) => {
  return (
    <div className="flex min-h-screen w-screen flex-1 flex-col items-center justify-center bg-background font-sans antialiased">
      <article className="prose">{children}</article>
    </div>
  );
};
