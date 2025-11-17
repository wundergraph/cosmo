import { PopoverContent } from "@/components/ui/popover";
import type { PopoverContentProps } from "@radix-ui/react-popover";

// There is an issue with Radix where having a scrollable area inside a popover, where scrolling the
// content inside the popover doesn't work. Because of this we are adding `onWheel` and `onTouchMove` to the
// `PopoverContent` to prevent that component from blocking the scroll.
//
// See: https://github.com/radix-ui/primitives/issues/1159
export function PopoverContentWithScrollableContent(props: Omit<PopoverContentProps, 'onWheel' | 'onTouchMove'>) {
  return (
    <PopoverContent
      onWheel={e => e.stopPropagation()}
      onTouchMove={e => e.stopPropagation()}
      {...props}
    />
  );
}