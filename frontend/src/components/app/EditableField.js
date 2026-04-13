import React, { useState, useRef, useEffect } from 'react';
import { Pencil, X } from 'lucide-react';
import WritingModal from './WritingModal';
import LatexTextarea from './LatexTextarea';

/**
 * Inline-editable field with pencil icon and save modes.
 *
 * Props
 * ─────
 *  value        – current string value
 *  onSave       – async (newValue, publish) => void — publish=true for Publish, false for Save quietly
 *  canEdit      – boolean — whether to show the pencil icon
 *  multiline    – boolean — use textarea instead of input (default false)
 *  placeholder  – placeholder text when empty
 *  className    – optional extra class on the display wrapper
 *  renderValue  – optional (value) => ReactNode for custom display (e.g. skill tags)
 *  showSaveModes – boolean — show Save quietly / Publish buttons (default true)
 *  editorTitle  – optional modal title for multiline editing
 *  editorSubtitle – optional modal subtitle for multiline editing
 */
export default function EditableField({
  value,
  onSave,
  canEdit = false,
  multiline = false,
  placeholder = '',
  className = '',
  renderValue,
  showSaveModes = true,
  editorTitle = 'Edit',
  editorSubtitle = '',
  enableLatex = false,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value || '');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if (multiline) {
        inputRef.current.selectionStart = inputRef.current.value.length;
      }
    }
  }, [editing, multiline]);

  const handleEdit = () => {
    setDraft(value || '');
    setEditing(true);
  };

  const handleCancel = () => {
    setEditing(false);
    setDraft(value || '');
  };

  const handleSave = async (publish = false) => {
    if (draft === value) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(draft, publish);
      setEditing(false);
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Escape') handleCancel();
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault();
      handleSave(false); // Enter = Save quietly by default
    }
  };

  if (editing && multiline) {
    return (
      <WritingModal
        title={editorTitle}
        subtitle={editorSubtitle}
        onClose={handleCancel}
        footer={(
          <div className="editable-field-actions">
            {showSaveModes ? (
              <>
                <button type="button" className="save-mode-btn quiet" onClick={() => handleSave(false)} disabled={saving} title="Save without notifying anyone">
                  Save quietly
                </button>
                <button type="button" className="save-mode-btn publish" onClick={() => handleSave(true)} disabled={saving} title="Save and show in activity feed">
                  Publish
                </button>
              </>
            ) : (
              <button type="button" className="save-mode-btn quiet" onClick={() => handleSave(false)} disabled={saving}>
                Save
              </button>
            )}
          </div>
        )}
      >
        {enableLatex ? (
          <LatexTextarea
            value={draft}
            onChange={setDraft}
            rows={12}
            placeholder={placeholder}
            disabled={saving}
            autoFocus
          />
        ) : (
          <textarea
            ref={inputRef}
            className="editable-field-input writing-modal-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={saving}
            rows={12}
          />
        )}
      </WritingModal>
    );
  }

  if (editing) {
    const InputEl = 'input';
    return (
      <>
        <div className="editable-field-backdrop" onClick={handleCancel} aria-hidden="true" />
        <div className="editable-field-editing editable-field-elevated">
        <InputEl
          ref={inputRef}
          className="editable-field-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={saving}
        />
        <div className="editable-field-actions">
          {showSaveModes ? (
            <>
              <button type="button" className="save-mode-btn quiet" onClick={() => handleSave(false)} disabled={saving} title="Save without notifying anyone">
                Save quietly
              </button>
              <button type="button" className="save-mode-btn publish" onClick={() => handleSave(true)} disabled={saving} title="Save and show in activity feed">
                Publish
              </button>
            </>
          ) : (
            <button type="button" className="save-mode-btn quiet" onClick={() => handleSave(false)} disabled={saving}>
              Save
            </button>
          )}
          <button type="button" className="editable-field-btn cancel" onClick={handleCancel} disabled={saving} title="Cancel">
            <X size={14} />
          </button>
        </div>
      </div>
      </>
    );
  }

  return (
    <div className={`editable-field-display ${className}`}>
      <div className="editable-field-value">
        {renderValue ? renderValue(value) : (value || <span className="editable-field-empty">{placeholder || 'Not set'}</span>)}
      </div>
      {canEdit && (
        <button type="button" className="editable-field-pencil" onClick={handleEdit} title="Edit">
          <Pencil size={13} />
        </button>
      )}
    </div>
  );
}
