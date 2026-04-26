import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import latexToMarkdown from '../../lib/latexToMarkdown';

const IMAGE_SIZE_HASH_PREFIX = '#yard-image-size-';
const VALID_IMAGE_SIZES = new Set(['small', 'medium', 'large']);
const IMAGE_MARKDOWN_PATTERN = /^!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)(?:\{size=(small|medium|large)\})?$/;

function applyImageSizeHints(markdown) {
  return markdown.replace(
    /!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)\{size=(small|medium|large)\}/g,
    (_, alt, src, size) => `![${alt}](${src}${IMAGE_SIZE_HASH_PREFIX}${size})`
  );
}

function getImageRenderProps(src) {
  const markerIndex = src.indexOf(IMAGE_SIZE_HASH_PREFIX);
  if (markerIndex === -1) {
    return { cleanSrc: src, size: 'medium' };
  }
  const size = src.slice(markerIndex + IMAGE_SIZE_HASH_PREFIX.length);
  return {
    cleanSrc: src.slice(0, markerIndex),
    size: VALID_IMAGE_SIZES.has(size) ? size : 'medium',
  };
}

function parseImageMarkdownLine(line) {
  const match = (line || '').trim().match(IMAGE_MARKDOWN_PATTERN);
  if (!match) return null;
  return {
    alt: match[1] || '',
    src: match[2] || '',
    size: VALID_IMAGE_SIZES.has(match[3]) ? match[3] : 'medium',
  };
}

function parseYardImageRows(markdown) {
  const parts = [];
  const rowPattern = /:::yard-image-row\s*\n([\s\S]*?)\n:::/g;
  let lastIndex = 0;
  let match = rowPattern.exec(markdown);

  while (match) {
    if (match.index > lastIndex) {
      parts.push({ type: 'markdown', content: markdown.slice(lastIndex, match.index) });
    }

    const images = match[1]
      .split('\n')
      .map(parseImageMarkdownLine)
      .filter(Boolean)
      .slice(0, 2);

    if (images.length > 0) {
      parts.push({ type: 'image-row', images });
    }

    lastIndex = rowPattern.lastIndex;
    match = rowPattern.exec(markdown);
  }

  if (lastIndex < markdown.length) {
    parts.push({ type: 'markdown', content: markdown.slice(lastIndex) });
  }

  return parts;
}

function MarkdownBlock({ content }) {
  const renderContent = applyImageSizeHints(content);
  if (!renderContent.trim()) return null;
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={markdownComponents}
    >
      {renderContent}
    </ReactMarkdown>
  );
}

const markdownComponents = {
  a: (props) => <a {...props} target="_blank" rel="noopener noreferrer" />,
  img: ({ src = '', alt = '' }) => {
    const { cleanSrc, size } = getImageRenderProps(src);
    return (
      <span className={`latex-content-figure latex-content-figure-${size}`}>
        <img src={cleanSrc} alt={alt} className="latex-content-image" />
        {alt ? <span className="latex-content-caption">{alt}</span> : null}
      </span>
    );
  },
};

function YardImageFigure({ image }) {
  return (
    <span className={`latex-content-figure latex-content-figure-${image.size}`}>
      <img src={image.src} alt={image.alt} className="latex-content-image" />
      {image.alt ? <span className="latex-content-caption">{image.alt}</span> : null}
    </span>
  );
}

export default function LatexContent({ text, className = '', emptyText = null, rawMarkdown = false }) {
  const content = typeof text === 'string' ? text.trim() : '';

  if (!content) {
    return emptyText ? <p className="latex-content-empty">{emptyText}</p> : null;
  }

  const markdown = rawMarkdown ? content : latexToMarkdown(content);
  const parts = parseYardImageRows(markdown);

  return (
    <div className={['latex-content', className].filter(Boolean).join(' ')}>
      {parts.map((part, index) => (
        part.type === 'image-row' ? (
          <div className="latex-content-image-row" key={`image-row-${index}`}>
            {part.images.map((image, imageIndex) => (
              <YardImageFigure image={image} key={`${image.src}-${imageIndex}`} />
            ))}
          </div>
        ) : (
          <MarkdownBlock content={part.content} key={`markdown-${index}`} />
        )
      ))}
    </div>
  );
}
