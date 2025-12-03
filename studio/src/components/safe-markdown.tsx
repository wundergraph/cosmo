import { useMemo } from "react";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import Markdown from "react-markdown";
import DOMPurify from "dompurify";

export interface SafeMarkdownProps {
  content: string | undefined | null;
}

export function SafeMarkdown({ content }: SafeMarkdownProps) {
  const safeContent = useMemo(() => content ? DOMPurify.sanitize(content) : '', [content]);
  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeRaw]}
      components={{
        a: ({ children, node, ...props }) => (
          <a {...props} target="_blank" rel="noopener noreferrer">{children}</a>
        ),
      }}
    >
      {safeContent}
    </Markdown>
  );
}