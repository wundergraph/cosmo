export interface LayoutProps {
  children?: React.ReactNode;
}

export const AuthLayout = ({ children }: LayoutProps) => {
  return (
    <div className="relative h-screen overflow-hidden bg-background dark">
      <div className="stars" />
      <div className="relative mx-auto flex h-screen max-w-screen-2xl flex-col items-center justify-center font-sans antialiased">
        {children}
      </div>
      <div className="circle-glow absolute top-[65%] aspect-square w-[100%] rounded-full bg-black" />
    </div>
  );
};
