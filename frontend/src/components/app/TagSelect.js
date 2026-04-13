import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { matchesSearchQuery } from '../../lib/search';

/**
 * A multi-select input that renders selected values as removable tags.
 * Props:
 *  - options: [{ value, label }]
 *  - value: string[] — array of selected values
 *  - onChange: (values: string[]) => void
 *  - placeholder: string
 *  - disabled: boolean
 */
export default function TagSelect({ options, value = [], onChange, placeholder = 'Search...', disabled = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);

  const unselected = options.filter(o => !value.includes(o.value));
  const filtered = query
    ? unselected.filter(o => matchesSearchQuery(query, o.label))
    : unselected;

  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleAdd = (opt) => {
    onChange([...value, opt.value]);
    setQuery('');
    inputRef.current?.focus();
  };

  const handleRemove = (val) => {
    onChange(value.filter(v => v !== val));
  };

  const getLabel = (val) => options.find(o => o.value === val)?.label || val;

  return (
    <div className="tag-select" ref={wrapperRef}>
      <div
        className={`tag-select-control${open ? ' focused' : ''}`}
        onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus(); } }}
      >
        {value.map(v => (
          <span key={v} className="tag-select-tag">
            <span className="tag-select-tag-label">{getLabel(v)}</span>
            {!disabled && (
              <button
                type="button"
                className="tag-select-remove"
                onClick={(e) => { e.stopPropagation(); handleRemove(v); }}
                aria-label={`Remove ${getLabel(v)}`}
              >
                <X size={11} />
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <input
            ref={inputRef}
            type="text"
            className="tag-select-input"
            placeholder={value.length === 0 ? placeholder : ''}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            disabled={disabled}
          />
        )}
      </div>
      {open && !disabled && (
        <div className="tag-select-dropdown">
          {filtered.length === 0 ? (
            <div className="tag-select-empty">{query ? 'No matches' : 'All projects selected'}</div>
          ) : (
            filtered.map(opt => (
              <button
                key={opt.value}
                type="button"
                className="tag-select-option"
                onClick={() => handleAdd(opt)}
              >
                {opt.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
