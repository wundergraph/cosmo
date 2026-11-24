import { postToHub } from '@/lib/embed';
import { ReactNode, useEffect, useRef } from 'react';

/** A Studio page inside Hub's frame: no navigation or title, and Hub sizes the frame to the content. */
export const EmbedLayout = ({ toolbar, children }: { toolbar?: ReactNode; children?: ReactNode }) => {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const content = contentRef.current;
    if (!content) {
      return;
    }

    const observer = new ResizeObserver(() => {
      postToHub({ source: 'cosmo-studio', type: 'height', height: Math.ceil(content.getBoundingClientRect().height) });
    });
    observer.observe(content);

    return () => observer.disconnect();
  }, []);

  return (
    <div ref={contentRef} className="flex flex-col gap-y-4 bg-background py-4 font-sans antialiased">
      {toolbar && <div className="flex justify-end">{toolbar}</div>}
      <div className="px-4 lg:px-8">{children}</div>
    </div>
  );
};
