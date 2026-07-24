'use client';

import React, { useState, useEffect } from 'react';
import styles from './RightSidebar.module.css';
import { X, Save, Edit3 } from 'lucide-react';

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string | undefined;
  onSavePrompt: (prompt: string) => void;
  isOcrMode: boolean;
}

const DEFAULT_PROMPT = "你是一个专业的学术与数理分析助手，精通复杂的数学计算、逻辑推理和文档分析。回答要条理清晰、准确直接。";

export default function RightSidebar({ isOpen, onClose, systemPrompt, onSavePrompt, isOcrMode }: RightSidebarProps) {
  const [localPrompt, setLocalPrompt] = useState(systemPrompt || '');

  useEffect(() => {
    setLocalPrompt(systemPrompt || '');
  }, [systemPrompt]);

  const handleSave = () => {
    onSavePrompt(localPrompt);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.sidebar}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Edit3 size={18} />
            <h3>System Prompt</h3>
          </div>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        {isOcrMode ? (
          <div className={styles.ocrNotice}>
            <p>This is the Fixed OCR session.</p>
            <p>Images uploaded here will only be processed by the Vision API to extract text.</p>
            <p>System Prompt is not applicable here.</p>
          </div>
        ) : (
          <div className={styles.content}>
            <p className={styles.hint}>
              Define the AI's persona and instructions for this specific conversation.
            </p>
            
            <textarea
              className={styles.textarea}
              value={localPrompt}
              onChange={(e) => setLocalPrompt(e.target.value)}
              placeholder={`Default:\n${DEFAULT_PROMPT}`}
            />
            
            <button className={styles.saveBtn} onClick={handleSave}>
              <Save size={18} /> Save & Apply
            </button>
          </div>
        )}
      </div>
    </>
  );
}
