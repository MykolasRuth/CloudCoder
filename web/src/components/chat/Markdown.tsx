import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ gfm: true, breaks: true });

// Sanitized: assistant output can quote hostile HTML from files/web pages it
// read — without sanitization that HTML would run on our origin with cookies.
export default function Markdown({ text }: { text: string }) {
  const html = useMemo(
    () => DOMPurify.sanitize(marked.parse(text, { async: false }) as string),
    [text],
  );
  return <div className="md text-[13.5px] leading-relaxed" dangerouslySetInnerHTML={{ __html: html }} />;
}
