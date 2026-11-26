import { postToHub } from '@/lib/embed';
import { ReactNode, useEffect, useRef } from 'react';

const dialogSelector = '[role="dialog"], [role="alertdialog"]';

/** A Studio page inside Hub's frame: no navigation or title, and Hub sizes the frame to the content. */
export const EmbedLayout = ({ toolbar, children }: { toolbar?: ReactNode; children?: ReactNode }) => {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    let posted: { height: number; overlay: boolean } | undefined;
    const postHeight = () => {
      // Dialogs and sheets are sized and placed by the frame, so the frame's height is the content's alone. While one
      // is open Hub gives the frame the viewport's height instead.
      const height = Math.ceil(content.getBoundingClientRect().height);
      const overlay = document.querySelector(dialogSelector) !== null;
      if (posted?.height === height && posted.overlay === overlay) {
        return;
      }

      posted = { height, overlay };
      postToHub({ source: 'cosmo-studio', type: 'height', height, overlay });
    };

    const resizeObserver = new ResizeObserver(postHeight);
    resizeObserver.observe(content);

    // Dialogs render in a portal outside the content.
    const dialogObserver = new MutationObserver(postHeight);
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
