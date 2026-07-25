'use client';

import React, { useState, useRef, useEffect } from 'react';
import styles from './ChatLayout.module.css';
import { Send, Paperclip, Settings, FileText, Image as ImageIcon, Loader2, Menu, Edit3 } from 'lucide-react';
import { useChat } from '@/hooks/useChat';
import SettingsDrawer from './SettingsDrawer';
import SidebarDrawer from './SidebarDrawer';
import RightSidebar from './RightSidebar';
import ParticleBackground from './ParticleBackground';
import { processFile } from '@/services/fileParser';
import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';

export default function ChatLayout() {
  const { 
    sessions, activeSessionId, setActiveSessionId, createSession, deleteSession, updateSystemPrompt,
    messages, sendMessage, isLoading, clearHistory, isOcrMode 
  } = useChat();
  
  const [input, setInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isRightSidebarOpen, setIsRightSidebarOpen] = useState(false);
  const [attachments, setAttachments] = useState<{name: string, type: string, content: string}[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSend = () => {
    if ((!input.trim() && attachments.length === 0) || isLoading) return;
    
    // Format message with attachments if any
    sendMessage(input, attachments);
    setInput('');
    setAttachments([]);
    
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const parsed = await processFile(file);
        if (parsed) {
          setAttachments(prev => [...prev, parsed]);
        }
      } catch (err) {
        alert(`Failed to parse file ${file.name}`);
      }
    }
    
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const activeTitle = sessions.find(s => s.id === activeSessionId)?.title || 'DeepSeek Copilot';

  return (
    <div className={styles.container}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <button className={styles.iconButton} onClick={() => setIsSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div className={styles.headerTitle}>
            <h2>{activeTitle}</h2>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button className={styles.iconButton} onClick={() => setIsRightSidebarOpen(true)}>
            <Edit3 size={22} />
          </button>
          <button className={styles.iconButton} onClick={() => setIsSettingsOpen(true)}>
            <Settings size={22} />
          </button>
        </div>
      </header>

      <div className={styles.chatArea}>
        {messages.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>✨</div>
            <h3>How can I help you today?</h3>
            <p>I can analyze logic, solve math, and read your documents.</p>
          </div>
        ) : (
          <div className={styles.messageList}>
            {messages.map((msg, idx) => (
              <div key={idx} className={`${styles.messageWrapper} ${msg.role === 'user' ? styles.messageUser : styles.messageAssistant}`}>
                <div className={styles.messageBubble}>
                  {/* If there's an image in the message context, display a thumbnail */}
                  {msg.attachments && msg.attachments.map((att, i) => (
                    <div key={i} className={styles.messageAttachment}>
                      {att.type.startsWith('image') ? (
                        <img src={att.content} alt={att.name} className={styles.attachmentImg} />
                      ) : (
                        <div className={styles.attachmentDoc}>
                          <FileText size={16} />
                          <span>{att.name}</span>
                        </div>
                      )}
                    </div>
                  ))}
                  <div className={styles.messageText}>
                    {isOcrMode ? (
                      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}>
                        {msg.content}
                      </pre>
                    ) : (
                      <>
                        {msg.reasoning && (
                          <details className={styles.reasoningBlock}>
                            <summary className={styles.reasoningSummary}>
                              🤔 DeepSeek Thinking...
                            </summary>
                            <div className={styles.reasoningContent}>
                              <ReactMarkdown 
                                remarkPlugins={[remarkMath]} 
                                rehypePlugins={[rehypeKatex]}
                              >
                                {msg.reasoning.replace(/\\\[/g, '$$$').replace(/\\\]/g, '$$$').replace(/\\\(/g, '$').replace(/\\\)/g, '$')}
                              </ReactMarkdown>
                            </div>
                          </details>
                        )}
                        <ReactMarkdown 
                          remarkPlugins={[remarkMath]} 
                          rehypePlugins={[rehypeKatex]}
                        >
                          {msg.content.replace(/\\\[/g, '$$$').replace(/\\\]/g, '$$$').replace(/\\\(/g, '$').replace(/\\\)/g, '$')}
                        </ReactMarkdown>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isLoading && (
              <div className={`${styles.messageWrapper} ${styles.messageAssistant}`}>
                <div className={styles.messageBubble}>
                  <Loader2 className={styles.spinner} size={20} />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      <div className={styles.inputArea}>
        {attachments.length > 0 && (
          <div className={styles.attachmentsPreview}>
            {attachments.map((att, idx) => (
              <div key={idx} className={styles.attachmentChip}>
                {att.type.startsWith('image') ? <ImageIcon size={14} /> : <FileText size={14} />}
                <span className={styles.attachmentName}>{att.name}</span>
                <button onClick={() => removeAttachment(idx)} className={styles.removeAttBtn}>&times;</button>
              </div>
            ))}
          </div>
        )}
        <div className={styles.inputWrapper}>
          <button className={styles.attachBtn} onClick={() => fileInputRef.current?.click()}>
            <Paperclip size={22} />
          </button>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileUpload}
            style={{ display: 'none' }} 
            accept="image/*,.pdf,.docx" 
            multiple 
          />
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Message Copilot..."
            rows={1}
          />
          <button 
            className={`${styles.sendBtn} ${(input.trim() || attachments.length > 0) && !isLoading ? styles.sendBtnActive : ''}`} 
            onClick={handleSend}
            disabled={(!input.trim() && attachments.length === 0) || isLoading}
          >
            <Send size={20} />
          </button>
        </div>
      </div>

      <SettingsDrawer 
        isOpen={isSettingsOpen} 
        onClose={() => setIsSettingsOpen(false)} 
        onClearHistory={clearHistory}
      />
      
      <SidebarDrawer
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onCreateSession={createSession}
        onDeleteSession={deleteSession}
      />

      <RightSidebar
        isOpen={isRightSidebarOpen}
        onClose={() => setIsRightSidebarOpen(false)}
        systemPrompt={sessions.find(s => s.id === activeSessionId)?.systemPrompt}
        onSavePrompt={updateSystemPrompt}
        isOcrMode={isOcrMode}
      />
      
      <ParticleBackground />
    </div>
  );
}
