export const Toolbar: React.FC<React.PropsWithChildren> = (props) => {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b px-4 py-4 lg:px-8">
      {props.children}
    </div>
  );
};
