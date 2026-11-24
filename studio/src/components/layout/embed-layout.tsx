import { postToHub } from '@/lib/embed';
import { ReactNode, useEffect, useRef } from 'react';

const dialogSelector = '[role="dialog"], [role="alertdialog"]';
const dialogMargin = 16;

/**
 * The height Hub gives the frame: the content, or while a dialog is open, enough for all of the dialog. Dialogs are
 * centered in the frame, so a dialog fits once the frame is its height plus a margin on each side.
 */
const frameHeight = (content: HTMLElement) =>
  Array.from(document.querySelectorAll<HTMLElement>(dialogSelector)).reduce(
    (height, dialog) =>
      Math.max(height, dialog.getBoundingClientRect().bottom + dialogMargin, dialog.offsetHeight + 2 * dialogMargin),
    content.getBoundingClientRect().height,
  );

/** A Studio page inside Hub's frame: no navigation or title, and Hub sizes the frame to the content. */
export const EmbedLayout = ({ toolbar, children }: { toolbar?: ReactNode; children?: ReactNode }) => {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    let postedHeight: number | undefined;
    const postHeight = () => {
      const height = Math.ceil(frameHeight(content));
      if (height === postedHeight) {
        return;
      }

      postedHeight = height;
      postToHub({ source: 'cosmo-studio', type: 'height', height });
    };

    const resizeObserver = new ResizeObserver(postHeight);
    resizeObserver.observe(content);

    // Dialogs render in a portal outside the content.
    const dialogObserver = new MutationObserver(() => {
      document.querySelectorAll(dialogSelector).forEach((dialog) => resizeObserver.observe(dialog));
      postHeight();
    });
    dialogObserver.observe(document.body, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      dialogObserver.disconnect();
    };
  }, []);

  return (
    <div ref={contentRef} className="flex flex-col gap-y-4 bg-background py-4 font-sans antialiased">
      {/* Hub's page already has the side margins, so the frame's content runs edge to edge. */}
      {toolbar && <div className="flex justify-end [&>*]:!px-0">{toolbar}</div>}
      {children}
    </div>
  );
};
