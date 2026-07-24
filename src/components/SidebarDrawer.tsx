'use client';

import React from 'react';
import styles from './SidebarDrawer.module.css';
import { Plus, MessageSquare, Image as ImageIcon, Trash2, X } from 'lucide-react';
import { ChatSession } from '@/hooks/useChat';

interface SidebarDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  sessions: ChatSession[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (id: string) => void;
}

export default function SidebarDrawer({
  isOpen, onClose, sessions, activeSessionId, onSelectSession, onCreateSession, onDeleteSession
}: SidebarDrawerProps) {
  
  if (!isOpen) return null;

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.sidebar}>
        <div className={styles.header}>
          <h3>Chats</h3>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={24} />
          </button>
        </div>

        <button className={styles.newChatBtn} onClick={() => { onCreateSession(); onClose(); }}>
          <Plus size={18} /> New Chat
        </button>

        <div className={styles.sessionList}>
          {sessions.map(session => (
            <div 
              key={session.id} 
              className={`${styles.sessionItem} ${activeSessionId === session.id ? styles.active : ''}`}
              onClick={() => { onSelectSession(session.id); onClose(); }}
            >
              <div className={styles.sessionIcon}>
                {session.isFixedOcr ? <ImageIcon size={18} /> : <MessageSquare size={18} />}
              </div>
              <div className={styles.sessionTitle}>
                {session.title}
              </div>
              {!session.isFixedOcr && (
                <button 
                  className={styles.deleteBtn} 
                  onClick={(e) => { e.stopPropagation(); onDeleteSession(session.id); }}
                >
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
