import { useState, useEffect, useRef, useCallback } from 'react';

export interface Attachment {
  name: string;
  type: string;
  content: string; // Base64 or Extracted Text
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
}

export interface ChatSession {
  id: string;
  title: string;
  isFixedOcr?: boolean;
  systemPrompt?: string;
  messages: Message[];
}

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  // Load history from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('DEEPSEEK_CHAT_SESSIONS');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.length > 0) {
          setSessions(parsed);
          setActiveSessionId(parsed[0].id);
        } else {
          initDefaultSessions();
        }
      } catch (e) {
        console.error('Failed to parse chat history', e);
        initDefaultSessions();
      }
    } else {
      initDefaultSessions();
    }
  }, []);

  const initDefaultSessions = () => {
    const defaultSessions: ChatSession[] = [
      { id: 'ocr-session', title: '🖼️ OCR Extraction Only', isFixedOcr: true, messages: [] },
      { id: Date.now().toString(), title: 'New Conversation', messages: [] }
    ];
    setSessions(defaultSessions);
    setActiveSessionId(defaultSessions[1].id); // Default to normal conversation
    localStorage.setItem('DEEPSEEK_CHAT_SESSIONS', JSON.stringify(defaultSessions));
  };

  const saveSessions = (updatedSessions: ChatSession[]) => {
    setSessions(updatedSessions);
    localStorage.setItem('DEEPSEEK_CHAT_SESSIONS', JSON.stringify(updatedSessions));
  };

  const createSession = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: []
    };
    const updated = [...sessions, newSession];
    saveSessions(updated);
    setActiveSessionId(newSession.id);
  };

  const deleteSession = (id: string) => {
    if (id === 'ocr-session') return; // Cannot delete fixed session
    const updated = sessions.filter(s => s.id !== id);
    if (updated.length === 0) {
      initDefaultSessions();
    } else {
      saveSessions(updated);
      if (activeSessionId === id) {
        setActiveSessionId(updated[0].id);
      }
    }
  };

  const updateSystemPrompt = (prompt: string) => {
    const updated = sessions.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, systemPrompt: prompt };
      }
      return s;
    });
    saveSessions(updated);
  };

  const clearCurrentHistory = () => {
    const updated = sessions.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, messages: [] };
      }
      return s;
    });
    saveSessions(updated);
  };

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];
  const isOcrMode = activeSession?.isFixedOcr || false;

  const sendMessage = async (content: string, attachments: Attachment[] = []) => {
    if (!activeSession) return;
    
    // Auto-generate title if it's the first message and not OCR session
    let updatedTitle = activeSession.title;
    if (messages.length === 0 && !activeSession.isFixedOcr) {
      updatedTitle = content.slice(0, 20) + (content.length > 20 ? '...' : '');
    }

    const userMsg: Message = { role: 'user', content, attachments };
    const newMessages = [...messages, userMsg];
    
    // Helper to build updated sessions array
    const updateCurrentSession = (msgs: Message[]) => {
      return sessions.map(s => {
        if (s.id === activeSessionId) {
          return { ...s, title: updatedTitle, messages: msgs };
        }
        return s;
      });
    };
    
    saveSessions(updateCurrentSession(newMessages));
    setIsLoading(true);

    try {
      const apiKey = localStorage.getItem('DEEPSEEK_API_KEY') || '';
      const model = localStorage.getItem('DEEPSEEK_MODEL') || 'deepseek-v4-pro';
      const baseUrl = localStorage.getItem('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1';
      
      const visionApiKey = localStorage.getItem('VISION_API_KEY') || '';
      const visionBaseUrl = localStorage.getItem('VISION_BASE_URL') || 'https://api.openai.com/v1';
      const visionModel = localStorage.getItem('VISION_MODEL') || 'gpt-4o-mini';

      // Read configurable parameters
      const maxTokens = parseInt(localStorage.getItem('DEEPSEEK_MAX_TOKENS') || '8192', 10);
      const temperature = parseFloat(localStorage.getItem('DEEPSEEK_TEMPERATURE') || '0.7');
      const maxContextMessages = parseInt(localStorage.getItem('DEEPSEEK_MAX_CONTEXT') || '50', 10);

      // Strip heavy Base64 image data from older messages to reduce payload size.
      // Only keep image attachments on the LAST message (needed for current OCR processing).
      const cleanedMessages = newMessages.map((msg, idx) => {
        if (idx < newMessages.length - 1 && msg.attachments) {
          return {
            ...msg,
            attachments: msg.attachments.filter(att => !att.type.startsWith('image/'))
          };
        }
        return msg;
      });

      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          messages: cleanedMessages,
          clientApiKey: apiKey,
          model: model,
          baseUrl: baseUrl,
          visionApiKey,
          visionBaseUrl,
          visionModel,
          mode: activeSession.isFixedOcr ? 'ocr-only' : 'integrated',
          systemPrompt: activeSession.systemPrompt,
          maxTokens,
          temperature,
          maxContextMessages
        })
      });

      if (!res.ok) {
        throw new Error(await res.text() || 'Failed to fetch response');
      }

      // Determine response type: stream or JSON
      if (!activeSession.isFixedOcr) {
        // --- Streaming mode ---
        setIsLoading(false);
        const reader = res.body?.getReader();
        const decoder = new TextDecoder('utf-8');
        let done = false;
        
        let assistantContent = '';
        const withEmpty = [...newMessages, { role: 'assistant' as const, content: '' }];
        setSessions(prev => prev.map(s =>
          s.id === activeSessionId ? { ...s, title: updatedTitle, messages: withEmpty } : s
        ));

        let buffer = '';
        let lastUIUpdate = 0;
        const THROTTLE_MS = 60;

        while (reader && !done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            buffer += decoder.decode(value, { stream: true });
            let newlineIndex;
            while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
              const line = buffer.slice(0, newlineIndex).trim();
              buffer = buffer.slice(newlineIndex + 1);
              
              // Skip SSE comments (heartbeats) and [DONE] signal
              if (!line || line.startsWith(':') || line === 'data: [DONE]') {
                continue;
              }

              if (line.startsWith('data: ')) {
                try {
                  const data = JSON.parse(line.slice(6));
                  const delta = data.choices?.[0]?.delta?.content || '';
                  if (delta) {
                    assistantContent += delta;
                  }
                } catch (e) {
                  // Ignore malformed JSON chunks
                }
              }
            }
            // Throttle React state updates
            const now = Date.now();
            if (now - lastUIUpdate >= THROTTLE_MS) {
              lastUIUpdate = now;
              const updated = [...newMessages, { role: 'assistant' as const, content: assistantContent }];
              setSessions(prev => prev.map(s =>
                s.id === activeSessionId ? { ...s, title: updatedTitle, messages: updated } : s
              ));
            }
          }
        }
        // Final update: persist to localStorage once at the end
        const finalMessages = [...newMessages, { role: 'assistant' as const, content: assistantContent }];
        saveSessions(updateCurrentSession(finalMessages));

      } else {
        // --- OCR JSON mode ---
        const rawText = await res.text();
        let data;
        try {
          data = JSON.parse(rawText);
        } catch (e: any) {
          throw new Error(`Response parse error. Raw: ${rawText.slice(0, 100)}...`);
        }
        const assistantMsg: Message = {
          role: 'assistant',
          content: data.message || 'No response.'
        };
        saveSessions(updateCurrentSession([...newMessages, assistantMsg]));
      }

    } catch (err: any) {
      console.error(err);
      const errorMsg: Message = {
        role: 'assistant',
        content: `**Error**: ${err.message}`
      };
      saveSessions(updateCurrentSession([...newMessages, errorMsg]));
    } finally {
      setIsLoading(false);
    }
  };

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    deleteSession,
    updateSystemPrompt,
    messages,
    sendMessage,
    isLoading,
    clearHistory: clearCurrentHistory,
    isOcrMode
  };
}
