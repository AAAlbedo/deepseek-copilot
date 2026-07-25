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

const DEFAULT_SYSTEM_PROMPT = "你是一个专业的学术与数理分析助手，精通复杂的数学计算、逻辑推理和文档分析。回答要条理清晰、准确直接。";

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
    setActiveSessionId(defaultSessions[1].id);
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
    if (id === 'ocr-session') return;
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

  // ─────────────────────────────────────────────────────────────
  //  DIRECT STREAMING: Browser → DeepSeek API (bypasses Vercel)
  // ─────────────────────────────────────────────────────────────
  const streamDirectly = async (
    newMessages: Message[],
    updatedTitle: string,
    updateCurrentSession: (msgs: Message[]) => ChatSession[]
  ) => {
    const apiKey = localStorage.getItem('DEEPSEEK_API_KEY') || '';
    const model = localStorage.getItem('DEEPSEEK_MODEL') || 'deepseek-v4-pro';
    const baseUrl = localStorage.getItem('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1';
    const maxTokens = parseInt(localStorage.getItem('DEEPSEEK_MAX_TOKENS') || '8192', 10);
    const temperature = parseFloat(localStorage.getItem('DEEPSEEK_TEMPERATURE') || '0.7');
    const maxContextMessages = parseInt(localStorage.getItem('DEEPSEEK_MAX_CONTEXT') || '50', 10);

    if (!apiKey) {
      throw new Error('DeepSeek API Key is missing. Please configure it in Settings.');
    }

    // Build the API URL
    let apiUrl = baseUrl;
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl.endsWith('/') ? `${apiUrl}chat/completions` : `${apiUrl}/chat/completions`;
    }

    // Build formatted messages with system prompt and context trimming
    const systemPrompt = activeSession?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const formattedMessages: { role: string; content: string }[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Trim context to the last N messages
    const trimmed = newMessages.length > maxContextMessages
      ? newMessages.slice(-maxContextMessages)
      : newMessages;

    for (let i = 0; i < trimmed.length; i++) {
      const msg = trimmed[i];
      let content = msg.content;

      // Append document text (PDF/DOCX), skip image Base64
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.type === 'pdf' || att.type === 'docx') {
            content += `\n\n--- Document (${att.name}) ---\n${att.content}\n--- End ---`;
          }
        }
      }

      formattedMessages.push({ role: msg.role, content });
    }

    const payload = {
      model,
      messages: formattedMessages,
      temperature,
      max_tokens: maxTokens,
      stream: true,
    };

    // *** Call DeepSeek API DIRECTLY from browser — no Vercel proxy ***
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API Error ${response.status}: ${errorText.slice(0, 200)}`);
    }

    // Stream reading
    setIsLoading(false);
    const reader = response.body?.getReader();
    const decoder = new TextDecoder('utf-8');
    let done = false;
    let assistantContent = '';
    let buffer = '';
    let lastUIUpdate = 0;
    const THROTTLE_MS = 60;

    // Add an empty assistant bubble immediately
    const withEmpty = [...newMessages, { role: 'assistant' as const, content: '' }];
    setSessions(prev => prev.map(s =>
      s.id === activeSessionId ? { ...s, title: updatedTitle, messages: withEmpty } : s
    ));

    while (reader && !done) {
      const { value, done: readerDone } = await reader.read();
      done = readerDone;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        let newlineIndex;
        while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);

          // Skip empty lines, SSE comments, and [DONE]
          if (!line || line.startsWith(':') || line === 'data: [DONE]') continue;

          if (line.startsWith('data: ')) {
            try {
              const data = JSON.parse(line.slice(6));
              const delta = data.choices?.[0]?.delta;
              if (delta) {
                // Handle both regular content and reasoning_content (for thinking models)
                const text = delta.content || delta.reasoning_content || '';
                if (text) {
                  assistantContent += text;
                }
              }
            } catch {
              // Ignore malformed chunks
            }
          }
        }

        // Throttle UI updates
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

    // Final: persist to localStorage
    const finalMessages = [...newMessages, { role: 'assistant' as const, content: assistantContent || '(No response generated)' }];
    saveSessions(updateCurrentSession(finalMessages));
  };

  // ──────────────────────────────────────────────────────
  //  OCR MODE: Uses Vercel API route (fast, no timeout)
  // ──────────────────────────────────────────────────────
  const callOcrRoute = async (
    newMessages: Message[],
    updateCurrentSession: (msgs: Message[]) => ChatSession[]
  ) => {
    const visionApiKey = localStorage.getItem('VISION_API_KEY') || '';
    const visionBaseUrl = localStorage.getItem('VISION_BASE_URL') || 'https://api.openai.com/v1';
    const visionModel = localStorage.getItem('VISION_MODEL') || 'gpt-4o-mini';

    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: newMessages,
        visionApiKey,
        visionBaseUrl,
        visionModel,
        mode: 'ocr-only',
      })
    });

    if (!res.ok) {
      throw new Error(await res.text() || 'OCR request failed');
    }

    const data = await res.json();
    const assistantMsg: Message = {
      role: 'assistant',
      content: data.message || 'No response.'
    };
    saveSessions(updateCurrentSession([...newMessages, assistantMsg]));
  };

  // ──────────────────────────────────────────────
  //  MAIN SEND MESSAGE
  // ──────────────────────────────────────────────
  const sendMessage = async (content: string, attachments: Attachment[] = []) => {
    if (!activeSession) return;

    let updatedTitle = activeSession.title;
    if (messages.length === 0 && !activeSession.isFixedOcr) {
      updatedTitle = content.slice(0, 20) + (content.length > 20 ? '...' : '');
    }

    const userMsg: Message = { role: 'user', content, attachments };
    const newMessages = [...messages, userMsg];

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
      if (activeSession.isFixedOcr) {
        await callOcrRoute(newMessages, updateCurrentSession);
      } else {
        await streamDirectly(newMessages, updatedTitle, updateCurrentSession);
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
