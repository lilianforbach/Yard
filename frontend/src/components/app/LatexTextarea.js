import React, { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from 'react';
import LatexContent from './LatexContent';

const LatexTextarea = forwardRef(function LatexTextarea({
  value,
  onChange,
  rows = 10,
  placeholder = '',
  disabled = false,
  previewEmptyText = 'Nothing to preview yet.',
  autoFocus = false,
}, ref) {
  const [mode, setMode] = useState('write');
  const [showPreviewHelp, setShowPreviewHelp] = useState(false);
  const textareaRef = useRef(null);
  const selectionRef = useRef({ start: 0, end: 0 });
  const previewHelpId = useId();

  const rememberSelection = () => {
    if (!textareaRef.current) return;
    selectionRef.current = {
      start: textareaRef.current.selectionStart,
      end: textareaRef.current.selectionEnd,
    };
  };

  useEffect(() => {
    if (mode === 'write' && autoFocus && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = textareaRef.current.value.length;
    }
  }, [autoFocus, mode]);

  useImperativeHandle(ref, () => ({
    insertText(textToInsert) {
      const currentValue = typeof value === 'string' ? value : '';
      const textarea = textareaRef.current;
      const selection = textarea
        ? { start: textarea.selectionStart, end: textarea.selectionEnd }
        : selectionRef.current;
      const start = Math.min(selection.start ?? currentValue.length, currentValue.length);
      const end = Math.min(selection.end ?? start, currentValue.length);
      const nextValue = `${currentValue.slice(0, start)}${textToInsert}${currentValue.slice(end)}`;
      onChange(nextValue);
      setMode('write');

      window.requestAnimationFrame(() => {
        if (!textareaRef.current) return;
        const nextCursor = start + textToInsert.length;
        textareaRef.current.focus();
        textareaRef.current.selectionStart = nextCursor;
        textareaRef.current.selectionEnd = nextCursor;
        selectionRef.current = { start: nextCursor, end: nextCursor };
      });
    },
  }), [onChange, value]);

  return (
    <div className="latex-editor">
      <div className="latex-editor-toolbar">
        <div className="latex-editor-toggle" role="tablist" aria-label="Writing mode">
          <button
            type="button"
            className={`latex-editor-toggle-btn ${mode === 'write' ? 'active' : ''}`}
            onClick={() => setMode('write')}
            aria-selected={mode === 'write'}
          >
            Write
          </button>
          <button
            type="button"
            className={`latex-editor-toggle-btn ${mode === 'preview' ? 'active' : ''}`}
            onClick={() => setMode('preview')}
            aria-selected={mode === 'preview'}
          >
            Preview
          </button>
        </div>
        <p className="latex-editor-hint">
          Best for text, equations, lists, tables, and sections
          <span
            className="latex-editor-help-wrap"
            onMouseEnter={() => setShowPreviewHelp(true)}
            onMouseLeave={() => setShowPreviewHelp(false)}
          >
            <button
              type="button"
              className="latex-editor-help-btn"
              aria-label="Preview help"
              aria-describedby={showPreviewHelp ? previewHelpId : undefined}
              aria-expanded={showPreviewHelp}
              onFocus={() => setShowPreviewHelp(true)}
              onBlur={() => setShowPreviewHelp(false)}
              onClick={() => setShowPreviewHelp((current) => !current)}
            >
              (?)
            </button>
            {showPreviewHelp ? (
              <div className="latex-editor-help-popover latex-editor-help-popover-inline" id={previewHelpId} role="tooltip">
                TikZ/PGFPlots figures are not rendered in preview. Use SVG uploads for graphics.
              </div>
            ) : null}
          </span>
          .
        </p>
      </div>

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          className="latex-editor-textarea"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onClick={rememberSelection}
          onFocus={rememberSelection}
          onKeyUp={rememberSelection}
          onSelect={rememberSelection}
          rows={rows}
          placeholder={placeholder}
          disabled={disabled}
        />
      ) : (
        <div className="latex-editor-preview">
          <LatexContent text={value} emptyText={previewEmptyText} />
        </div>
      )}
    </div>
  );
});

export default LatexTextarea;
