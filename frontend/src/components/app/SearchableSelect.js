import React, { useEffect, useId, useRef, useState } from 'react';
import { matchesSearchQuery } from '../../lib/search';

/**
 * A dropdown that lets users type to filter options, then click to select.
 * Props:
 *  - options: [{ value, label }]
 *  - value: currently selected value
 *  - onChange: (value) => void
 *  - placeholder: string
 *  - disabled: boolean
 *  - testId: string (optional data-testid)
 */
export default function SearchableSelect({ options, value, onChange, placeholder = 'Search...', disabled = false, testId }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const inputId = useId();
  const listboxId = `${inputId}-listbox`;

  const selectedOption = options.find(o => o.value === value);

  const filtered = query
    ? options.filter(o => matchesSearchQuery(query, o.label))
    : options;

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
        setQuery('');
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  useEffect(() => {
    if (!open || filtered.length === 0) {
      setHighlightedIndex(-1);
      return;
    }

    if (highlightedIndex >= filtered.length) {
      setHighlightedIndex(filtered.length - 1);
      return;
    }

    if (highlightedIndex === -1) {
      const selectedIndex = filtered.findIndex((opt) => opt.value === value);
      setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : 0);
    }
  }, [filtered, highlightedIndex, open, value]);

  const handleSelect = (opt) => {
    onChange(opt.value);
    setOpen(false);
    setQuery('');
    setHighlightedIndex(-1);
  };

  const handleInputFocus = () => {
    setOpen(true);
    setQuery('');
    const selectedIndex = options.findIndex((opt) => opt.value === value);
    setHighlightedIndex(selectedIndex >= 0 ? selectedIndex : (options.length > 0 ? 0 : -1));
  };

  const handleClear = (e) => {
    e.stopPropagation();
    onChange('');
    setQuery('');
    setOpen(false);
    setHighlightedIndex(-1);
  };

  const closeDropdown = () => {
    setOpen(false);
    setQuery('');
    setHighlightedIndex(-1);
  };

  const getOptionId = (opt) => `${inputId}-option-${String(opt.value).replace(/[^a-zA-Z0-9_-]+/g, '-')}`;

  const handleInputKeyDown = (event) => {
    if (disabled) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        handleInputFocus();
        return;
      }
      if (filtered.length > 0) {
        setHighlightedIndex((current) => (current + 1 + filtered.length) % filtered.length);
      }
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        handleInputFocus();
        return;
      }
      if (filtered.length > 0) {
        setHighlightedIndex((current) => (current <= 0 ? filtered.length - 1 : current - 1));
      }
      return;
    }

    if (event.key === 'Enter' && open && highlightedIndex >= 0 && highlightedIndex < filtered.length) {
      event.preventDefault();
      handleSelect(filtered[highlightedIndex]);
      return;
    }

    if (event.key === 'Escape' && open) {
      event.preventDefault();
      closeDropdown();
      inputRef.current?.blur();
      return;
    }

    if (event.key === 'Tab') {
      closeDropdown();
    }
  };

  return (
    <div className="searchable-select" ref={wrapperRef}>
      <div className="searchable-select-input-wrap" onClick={() => { if (!disabled) { setOpen(true); inputRef.current?.focus(); } }}>
        <input
          id={inputId}
          ref={inputRef}
          data-testid={testId}
          type="text"
          className="searchable-select-input"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-activedescendant={open && highlightedIndex >= 0 && highlightedIndex < filtered.length ? getOptionId(filtered[highlightedIndex]) : undefined}
          placeholder={selectedOption ? selectedOption.label : placeholder}
          value={open ? query : (selectedOption ? selectedOption.label : '')}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={handleInputFocus}
          onKeyDown={handleInputKeyDown}
          disabled={disabled}
        />
        {value && !open && (
          <button type="button" className="searchable-select-clear" onClick={handleClear} aria-label="Clear selection">
            ×
          </button>
        )}
      </div>
      {open && !disabled && (
        <div className="searchable-select-dropdown" id={listboxId} role="listbox" aria-labelledby={inputId}>
          {filtered.length === 0 ? (
            <div className="searchable-select-empty">No matches</div>
          ) : (
            filtered.map((opt, index) => (
              <button
                key={opt.value}
                id={getOptionId(opt)}
                type="button"
                role="option"
                aria-selected={opt.value === value}
                className={`searchable-select-option ${opt.value === value ? 'selected' : ''} ${index === highlightedIndex ? 'highlighted' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setHighlightedIndex(index)}
                onClick={() => handleSelect(opt)}
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
