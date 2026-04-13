import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import latexToMarkdown from '../../lib/latexToMarkdown';

const markdownComponents = {
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
};

export default function LatexContent({ text, className = '', emptyText = null }) {
  const content = typeof text === 'string' ? text.trim() : '';

  if (!content) {
    return emptyText ? <p className="latex-content-empty">{emptyText}</p> : null;
  }

  return (
    <div className={['latex-content', className].filter(Boolean).join(' ')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={markdownComponents}
      >
        {latexToMarkdown(content)}
      </ReactMarkdown>
    </div>
  );
}
