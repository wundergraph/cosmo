import { cn } from "@/lib/utils";
import { Dialog, Transition } from "@headlessui/react";
import { Fragment } from "react";

const Dialog2Overlay = () => {
  return (
    <div
      className="fixed inset-0 bg-background/80 backdrop-blur-sm"
      aria-hidden="true"
    />
  );
};

const Dialog2Title = ({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) => {
  return (
    <Dialog.Title
      className={cn(
        "text-lg font-semibold leading-none tracking-tight",
        className
      )}
    >
      {children}
    </Dialog.Title>
  );
};

const Dialog2Content = ({
  children,
  className,
}: {
  children?: React.ReactNode;
  className?: string;
}) => {
  return (
    <Dialog.Panel
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border bg-background p-6 shadow-lg duration-200 sm:rounded-lg md:w-full",
        className
      )}
    >
      {children}
    </Dialog.Panel>
  );
};

const Dialog2 = ({
  children,
  isOpen,
  setIsOpen,
}: {
  children?: React.ReactNode;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}) => {
  return (
    <Transition
      show={isOpen}
      enter="transition duration-100 ease-out"
      enterFrom="transform scale-95 opacity-0"
      enterTo="transform scale-100 opacity-100"
      leave="transition duration-75 ease-out"
      leaveFrom="transform scale-100 opacity-100"
      leaveTo="transform scale-95 opacity-0"
      as={Fragment}
    >
      <Dialog
        open={isOpen}
        onClose={() => setIsOpen(false)}
        className="relative z-50"
      >
        <Dialog2Overlay />
        {children}
      </Dialog>
    </Transition>
  );
};

export { Dialog2, Dialog2Content, Dialog2Title };
