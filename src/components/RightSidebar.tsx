'use client';

import React, { useState, useEffect } from 'react';
import styles from './RightSidebar.module.css';
import { X, Save, Edit3, Sliders, Brain, Zap } from 'lucide-react';

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
  const [maxTokens, setMaxTokens] = useState(8192);
  const [temperature, setTemperature] = useState(0.7);
  const [maxContext, setMaxContext] = useState(50);
  const [thinkingEnabled, setThinkingEnabled] = useState(true);

  useEffect(() => {
    setLocalPrompt(systemPrompt || '');
  }, [systemPrompt]);

  // Load saved settings on mount
  useEffect(() => {
    const savedMaxTokens = localStorage.getItem('DEEPSEEK_MAX_TOKENS');
    const savedTemperature = localStorage.getItem('DEEPSEEK_TEMPERATURE');
    const savedMaxContext = localStorage.getItem('DEEPSEEK_MAX_CONTEXT');
    const savedThinking = localStorage.getItem('DEEPSEEK_THINKING_ENABLED');
    if (savedMaxTokens) setMaxTokens(parseInt(savedMaxTokens, 10));
    if (savedTemperature) setTemperature(parseFloat(savedTemperature));
    if (savedMaxContext) setMaxContext(parseInt(savedMaxContext, 10));
    if (savedThinking !== null) setThinkingEnabled(savedThinking === 'true');
  }, []);

  const handleSave = () => {
    onSavePrompt(localPrompt);
    localStorage.setItem('DEEPSEEK_MAX_TOKENS', maxTokens.toString());
    localStorage.setItem('DEEPSEEK_TEMPERATURE', temperature.toString());
    localStorage.setItem('DEEPSEEK_MAX_CONTEXT', maxContext.toString());
    localStorage.setItem('DEEPSEEK_THINKING_ENABLED', thinkingEnabled.toString());
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
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        {isOcrMode ? (
          <div className={styles.ocrNotice}>
            <p>This is the Fixed OCR session.</p>
            <p>Images uploaded here will only be processed by the Vision API to extract text.</p>
            <p>Configuration is not applicable here.</p>
          </div>
        ) : (
          <div className={styles.content}>
            {/* System Prompt Section */}
            <div className={styles.section}>
              <label className={styles.sectionLabel}>
                <Edit3 size={14} />
                System Prompt
              </label>
              <textarea
                className={styles.textarea}
                value={localPrompt}
                onChange={(e) => setLocalPrompt(e.target.value)}
                placeholder={`Default:\n${DEFAULT_PROMPT}`}
                rows={4}
              />
            </div>

            {/* Thinking Mode Toggle */}
            <div className={styles.section}>
              <label className={styles.sectionLabel}>
                <Brain size={14} />
                Thinking Mode
              </label>
              <div
                className={`${styles.toggleCard} ${thinkingEnabled ? styles.toggleCardOn : styles.toggleCardOff}`}
                onClick={() => setThinkingEnabled(!thinkingEnabled)}
              >
                <div className={styles.toggleInfo}>
                  <div className={styles.toggleIcon}>
                    {thinkingEnabled ? <Brain size={20} /> : <Zap size={20} />}
                  </div>
                  <div>
                    <div className={styles.toggleTitle}>
                      {thinkingEnabled ? '深度思考 ON' : '直接回答 ON'}
                    </div>
                    <div className={styles.toggleDesc}>
                      {thinkingEnabled
                        ? '模型会先推理再回答，更精准但消耗更多 Token'
                        : '跳过思考过程，所有 Token 用于输出，适合大任务'}
                    </div>
                  </div>
                </div>
                <div className={`${styles.toggleSwitch} ${thinkingEnabled ? styles.toggleSwitchOn : ''}`}>
                  <div className={styles.toggleKnob} />
                </div>
              </div>
            </div>

            {/* Model Parameters Section */}
            <div className={styles.section}>
              <label className={styles.sectionLabel}>
                <Sliders size={14} />
                Model Parameters
              </label>

              {/* Max Tokens */}
              <div className={styles.sliderGroup}>
                <div className={styles.sliderHeader}>
                  <span>Max Tokens (回复长度上限)</span>
                  <span className={styles.sliderValue}>{maxTokens.toLocaleString()}</span>
                </div>
                <input
                  type="range"
                  className={styles.slider}
                  min={256}
                  max={131072}
                  step={256}
                  value={maxTokens}
                  onChange={(e) => setMaxTokens(parseInt(e.target.value, 10))}
                />
                <div className={styles.sliderLabels}>
                  <span>256</span>
                  <span>131,072 (Max)</span>
                </div>
              </div>

              {/* Temperature */}
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
                  onChange={(e) => setTemperature(parseFloat(e.target.value))}
                />
                <div className={styles.sliderLabels}>
                  <span>精确 0</span>
                  <span>2.0 随机</span>
                </div>
              </div>

              {/* Max Context Messages */}
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
                  onChange={(e) => setMaxContext(parseInt(e.target.value, 10))}
                />
                <div className={styles.sliderLabels}>
                  <span>2 (短)</span>
                  <span>10000 (极长)</span>
                </div>
              </div>
            </div>
            
            <button className={styles.saveBtn} onClick={handleSave}>
              <Save size={18} /> Save & Apply
            </button>
          </div>
        )}
      </div>
    </>
  );
}
