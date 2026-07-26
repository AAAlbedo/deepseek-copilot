'use client';

import React, { useEffect, useState } from 'react';
import styles from './SettingsDrawer.module.css';
import { X, Trash2, Key, Cpu } from 'lucide-react';

interface SettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onClearHistory: () => void;
}

export default function SettingsDrawer({ isOpen, onClose, onClearHistory }: SettingsDrawerProps) {
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('deepseek-v4-pro');
  const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com/v1');
  
  const [visionApiKey, setVisionApiKey] = useState('');
  const [visionBaseUrl, setVisionBaseUrl] = useState('https://api.openai.com/v1');
  const [visionModel, setVisionModel] = useState('gpt-4o-mini');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setApiKey(localStorage.getItem('DEEPSEEK_API_KEY') || '');
      setModel(localStorage.getItem('DEEPSEEK_MODEL') || 'deepseek-v4-pro');
      setBaseUrl(localStorage.getItem('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1');
      
      setVisionApiKey(localStorage.getItem('VISION_API_KEY') || '');
      setVisionBaseUrl(localStorage.getItem('VISION_BASE_URL') || 'https://api.openai.com/v1');
      setVisionModel(localStorage.getItem('VISION_MODEL') || 'gpt-4o-mini');
    }
  }, []);

  const handleSave = () => {
    localStorage.setItem('DEEPSEEK_API_KEY', apiKey);
    localStorage.setItem('DEEPSEEK_MODEL', model);
    localStorage.setItem('DEEPSEEK_BASE_URL', baseUrl);
    
    localStorage.setItem('VISION_API_KEY', visionApiKey);
    localStorage.setItem('VISION_BASE_URL', visionBaseUrl);
    localStorage.setItem('VISION_MODEL', visionModel);
    
    onClose();
  };

  const handleClear = () => {
    if (confirm('Are you sure you want to clear all chat history?')) {
      onClearHistory();
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.header}>
          <h3>Settings</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <div className={styles.content}>
          <div className={styles.sectionTitle}>DeepSeek V4 Pro API</div>
          
          <div className={styles.settingItem}>
            <label className={styles.label}>
              <Key size={16} /> API Key
            </label>
            <input 
              type="password" 
              className={styles.input}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="Leave empty to use default"
            />
          </div>

          <div className={styles.settingItem}>
            <label className={styles.label}>
              <Cpu size={16} /> API Base URL
            </label>
            <input 
              type="text" 
              className={styles.input}
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.deepseek.com/v1"
            />
          </div>

          <div className={styles.settingItem}>
            <label className={styles.label}>
              <Cpu size={16} /> Model
            </label>
            <input 
              type="text" 
              className={styles.input}
              value={model}
              onChange={e => setModel(e.target.value)}
              placeholder="e.g. deepseek-chat"
            />
          </div>

          <div className={styles.sectionTitle} style={{marginTop: '16px'}}>Vision API (For OCR/Images)</div>
          
          <div className={styles.settingItem}>
            <label className={styles.label}>
              <Key size={16} /> Vision API Key
            </label>
            <input 
              type="password" 
              className={styles.input}
              value={visionApiKey}
              onChange={e => setVisionApiKey(e.target.value)}
              placeholder="OpenAI or Custom Provider Key"
            />
          </div>

          <div className={styles.settingItem}>
            <label className={styles.label}>
              <Cpu size={16} /> Vision Base URL
            </label>
            <input 
              type="text" 
              className={styles.input}
              value={visionBaseUrl}
              onChange={e => setVisionBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
            />
          </div>

          <div className={styles.settingItem}>
            <label className={styles.label}>
              <Cpu size={16} /> Vision Model
            </label>
            <input 
              type="text" 
              className={styles.input}
              value={visionModel}
              onChange={e => setVisionModel(e.target.value)}
              placeholder="e.g. gpt-4o-mini"
            />
          </div>

          <div className={styles.actions}>
            <button className={styles.saveBtn} onClick={handleSave}>
              Save Settings
            </button>
            <button className={styles.clearBtn} onClick={handleClear}>
              <Trash2 size={18} /> Clear Chat History
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
