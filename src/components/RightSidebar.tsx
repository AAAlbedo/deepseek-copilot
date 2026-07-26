'use client';

import React, { useEffect, useState } from 'react';
import { Edit3, Save, Sliders, X } from 'lucide-react';
import styles from './RightSidebar.module.css';

interface RightSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  systemPrompt: string | undefined;
  onSavePrompt: (prompt: string) => void;
  isOcrMode: boolean;
}

const DEFAULT_PROMPT =
  '你是一个专业的学术与数理分析助手，精通复杂的数学计算、逻辑推理和文档分析。回答要条理清晰、准确直接。';

export default function RightSidebar({
  isOpen,
  onClose,
  systemPrompt,
  onSavePrompt,
  isOcrMode,
}: RightSidebarProps) {
  const [localPrompt, setLocalPrompt] = useState(systemPrompt || '');
  const [maxTokens, setMaxTokens] = useState(65536);
  const [temperature, setTemperature] = useState(0.7);
  const [maxContext, setMaxContext] = useState(100);

  useEffect(() => {
    setLocalPrompt(systemPrompt || '');
  }, [systemPrompt]);

  useEffect(() => {
    const savedMaxTokens = localStorage.getItem('DEEPSEEK_MAX_TOKENS');
    const savedTemperature = localStorage.getItem('DEEPSEEK_TEMPERATURE');
    const savedMaxContext = localStorage.getItem('DEEPSEEK_MAX_CONTEXT');
    if (savedMaxTokens) setMaxTokens(parseInt(savedMaxTokens, 10));
    if (savedTemperature) setTemperature(parseFloat(savedTemperature));
    if (savedMaxContext) setMaxContext(parseInt(savedMaxContext, 10));
  }, []);

  const handleSave = () => {
    onSavePrompt(localPrompt);
    localStorage.setItem('DEEPSEEK_MAX_TOKENS', maxTokens.toString());
    localStorage.setItem('DEEPSEEK_TEMPERATURE', temperature.toString());
    localStorage.setItem('DEEPSEEK_MAX_CONTEXT', maxContext.toString());
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.sidebar}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Sliders size={18} />
            <h3>Session Config</h3>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close session settings">
            <X size={24} />
          </button>
        </div>

        {isOcrMode ? (
          <div className={styles.ocrNotice}>
            <p>This is the Fixed OCR session.</p>
            <p>Images uploaded here are processed by the Vision API for text extraction only.</p>
            <p>Session configuration is not applicable here.</p>
          </div>
        ) : (
          <div className={styles.content}>
            <div className={styles.section}>
              <label className={styles.sectionLabel} htmlFor="system-prompt">
                <Edit3 size={14} />
                System Prompt
              </label>
              <textarea
                id="system-prompt"
                className={styles.textarea}
                value={localPrompt}
                onChange={(event) => setLocalPrompt(event.target.value)}
                placeholder={`Default:\n${DEFAULT_PROMPT}`}
                rows={4}
              />
            </div>

            <div className={styles.section}>
              <div className={styles.sectionLabel}>
                <Sliders size={14} />
                Model Parameters
              </div>

              <div className={styles.sliderGroup}>
                <div className={styles.sliderHeader}>
                  <span>Max Tokens (回复长度上限)</span>
                  <span className={styles.sliderValue}>{maxTokens.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  className={styles.slider}
                  min={256}
                  max={393216}
                  step={256}
                  value={maxTokens}
                  onChange={(event) => setMaxTokens(parseInt(event.target.value, 10))}
                />
                <div className={styles.sliderLabels}>
                  <span>256</span>
                  <span>393,216 (Max)</span>
                </div>
              </div>

              <div className={styles.sliderGroup}>
                <div className={styles.sliderHeader}>
                  <span>Temperature (创造性)</span>
                  <span className={styles.sliderValue}>{temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  className={styles.slider}
                  min={0}
                  max={2}
                  step={0.1}
                  value={temperature}
                  onChange={(event) => setTemperature(parseFloat(event.target.value))}
                />
                <div className={styles.sliderLabels}>
                  <span>精确 0</span>
                  <span>2.0 随机</span>
                </div>
              </div>

              <div className={styles.sliderGroup}>
                <div className={styles.sliderHeader}>
                  <span>Context Length (上下文轮数)</span>
                  <span className={styles.sliderValue}>{maxContext} msgs</span>
                </div>
                <input
                  type="range"
                  className={styles.slider}
                  min={2}
                  max={10000}
                  step={10}
                  value={maxContext}
                  onChange={(event) => setMaxContext(parseInt(event.target.value, 10))}
                />
                <div className={styles.sliderLabels}>
                  <span>2 (短)</span>
                  <span>10,000 (极长)</span>
                </div>
              </div>
            </div>

            <button className={styles.saveBtn} onClick={handleSave}>
              <Save size={18} /> Save &amp; Apply
            </button>
          </div>
        )}
      </div>
    </>
  );
}
