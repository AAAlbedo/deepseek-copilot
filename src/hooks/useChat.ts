import { useEffect, useState } from 'react';

export interface Attachment {
  name: string;
  type: string;
  content: string;
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

type StreamOutcome = {
  content: string;
  finishReason: string | null;
  receivedDone: boolean;
  streamError: string | null;
};

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_MAX_TOKENS = 65536;
const DEFAULT_MAX_CONTEXT_MESSAGES = 100;
const MAX_AUTO_CONTINUATIONS = 2;
const CONTINUE_PROMPT =
  'Continue the previous answer exactly where it stopped. Do not repeat completed text. Keep the same structure and finish the remaining work.';
const DEFAULT_SYSTEM_PROMPT =
  '你是一个专业的学术与数理分析助手，精通复杂的数学计算、逻辑推理和文档分析。回答要条理清晰、准确直接。';

function getStoredNumber(key: string, fallback: number) {
  const value = Number(localStorage.getItem(key));
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Reads an OpenAI-compatible SSE response without assuming chunks line up with
 * events. V4 Pro is explicitly requested in non-thinking mode, so only the
 * user-facing answer is retained.
 */
async function consumeChatStream(
  response: Response,
  initialContent: string,
  onProgress: (content: string) => void,
): Promise<StreamOutcome> {
  if (!response.body) {
    throw new Error('The API returned no response stream.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let content = initialContent;
  let finishReason: string | null = null;
  let receivedDone = false;
  let streamError: string | null = null;
  let buffer = '';
  let lastUiUpdate = 0;
  const UI_UPDATE_INTERVAL_MS = 100;

  const publish = (force = false) => {
    const now = Date.now();
    if (force || now - lastUiUpdate >= UI_UPDATE_INTERVAL_MS) {
      lastUiUpdate = now;
      onProgress(content);
    }
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.trim();
    if (!line || line.startsWith(':') || !line.startsWith('data:')) return;

    const dataText = line.slice(5).trimStart();
    if (dataText === '[DONE]') {
      receivedDone = true;
      return;
    }

    try {
      const data = JSON.parse(dataText);
      const choice = data.choices?.[0];
      if (!choice) return;

      const delta = choice.delta;
      if (delta && typeof delta === 'object') {
        const deltaRecord = delta as Record<string, unknown>;
        if (typeof deltaRecord.content === 'string') {
          content += deltaRecord.content;
        }
      }

      if (typeof choice.finish_reason === 'string') {
        finishReason = choice.finish_reason;
      }
    } catch {
      // Ignore provider keep-alives and malformed non-data SSE events. A
      // missing [DONE] is still reported to the user after the stream closes.
    }
  };

  const processBufferedLines = () => {
    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex >= 0) {
      processLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf('\n');
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        processBufferedLines();
        publish();
      }
      if (done) break;
    }
  } catch (error) {
    streamError = error instanceof Error ? error.message : String(error);
  }

  buffer += decoder.decode();
  processBufferedLines();
  if (buffer.trim()) processLine(buffer);
  publish(true);

  return { content, finishReason, receivedDone, streamError };
}

export function useChat() {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('DEEPSEEK_CHAT_SESSIONS');
    if (!saved) {
      initDefaultSessions();
      return;
    }

    try {
      const parsed = JSON.parse(saved) as Array<ChatSession & {
        messages: Array<Message & Record<string, unknown>>;
      }>;
      const sessionsWithoutLegacyReasoning = parsed.map((session) => ({
        ...session,
        messages: session.messages.map((msg) => {
          const clean: Message = { role: msg.role, content: msg.content };
          if (msg.attachments) clean.attachments = msg.attachments;
          return clean;
        }),
      }));
      if (sessionsWithoutLegacyReasoning.length > 0) {
        setSessions(sessionsWithoutLegacyReasoning);
        setActiveSessionId(sessionsWithoutLegacyReasoning[0].id);
        // Remove previously persisted chain-of-thought from browser storage.
        localStorage.setItem('DEEPSEEK_CHAT_SESSIONS', JSON.stringify(sessionsWithoutLegacyReasoning));
      } else {
        initDefaultSessions();
      }
    } catch (error) {
      console.error('Failed to parse chat history', error);
      initDefaultSessions();
    }
  }, []);

  const initDefaultSessions = () => {
    const defaultSessions: ChatSession[] = [
      { id: 'ocr-session', title: '🔎 OCR Extraction Only', isFixedOcr: true, messages: [] },
      { id: Date.now().toString(), title: 'New Conversation', messages: [] },
    ];
    setSessions(defaultSessions);
    setActiveSessionId(defaultSessions[1].id);
    localStorage.setItem('DEEPSEEK_CHAT_SESSIONS', JSON.stringify(defaultSessions));
  };

  const saveSessions = (updatedSessions: ChatSession[]) => {
    setSessions(updatedSessions);
    try {
      localStorage.setItem('DEEPSEEK_CHAT_SESSIONS', JSON.stringify(updatedSessions));
    } catch (error) {
      // A large document can exceed localStorage while an answer is streaming.
      // Keep the completed answer in memory instead of replacing it with an
      // error message; the user can still copy it or clear old history.
      console.warn('Chat history was not persisted because browser storage is full.', error);
    }
  };

  const createSession = () => {
    const newSession: ChatSession = {
      id: Date.now().toString(),
      title: 'New Conversation',
      messages: [],
    };
    const updated = [...sessions, newSession];
    saveSessions(updated);
    setActiveSessionId(newSession.id);
  };

  const deleteSession = (id: string) => {
    if (id === 'ocr-session') return;
    const updated = sessions.filter((session) => session.id !== id);
    if (updated.length === 0) {
      initDefaultSessions();
      return;
    }
    saveSessions(updated);
    if (activeSessionId === id) setActiveSessionId(updated[0].id);
  };

  const updateSystemPrompt = (prompt: string) => {
    saveSessions(
      sessions.map((session) =>
        session.id === activeSessionId ? { ...session, systemPrompt: prompt } : session,
      ),
    );
  };

  const clearCurrentHistory = () => {
    saveSessions(
      sessions.map((session) =>
        session.id === activeSessionId ? { ...session, messages: [] } : session,
      ),
    );
  };

  const activeSession = sessions.find((session) => session.id === activeSessionId) || sessions[0];
  const messages = activeSession?.messages || [];
  const isOcrMode = activeSession?.isFixedOcr || false;

  const formatMessages = (sourceMessages: Message[], maxContextMessages: number) => {
    const systemPrompt = activeSession?.systemPrompt || DEFAULT_SYSTEM_PROMPT;
    const contextLimit = Math.max(2, Math.floor(maxContextMessages));
    const trimmed = sourceMessages.length > contextLimit
      ? sourceMessages.slice(-contextLimit)
      : sourceMessages;

    return [
      { role: 'system', content: systemPrompt },
      ...trimmed.map((message) => {
        let content = message.content;
        for (const attachment of message.attachments || []) {
          if (attachment.type === 'pdf' || attachment.type === 'docx') {
            content += `\n\n--- Document (${attachment.name}) ---\n${attachment.content}\n--- End ---`;
          }
        }

        return { role: message.role, content };
      }),
    ];
  };

  const streamWithAutomaticContinuation = async (
    newMessages: Message[],
    updatedTitle: string,
    updateCurrentSession: (msgs: Message[]) => ChatSession[],
    requestCompletion: (requestMessages: Message[]) => Promise<Response>,
  ) => {
    let requestMessages = newMessages;
    let assistantContent = '';
    let finishReason: string | null = null;
    let receivedDone = false;
    let streamInterrupted = false;

    const updateVisibleAnswer = (content: string) => {
      const updated = [
        ...newMessages,
        { role: 'assistant' as const, content },
      ];
      setSessions((previous) =>
        previous.map((session) =>
          session.id === activeSessionId
            ? { ...session, title: updatedTitle, messages: updated }
            : session,
        ),
      );
    };

    // Keep the send button disabled until the final stream has completed. The
    // previous implementation cleared it after headers arrived, which allowed
    // overlapping large requests to overwrite the visible answer.
    updateVisibleAnswer('');

    for (let attempt = 0; attempt <= MAX_AUTO_CONTINUATIONS; attempt += 1) {
      let response: Response;
      try {
        response = await requestCompletion(requestMessages);
      } catch (error) {
        if (!assistantContent) throw error;
        assistantContent += '\n\n⚠️ **Connection ended while continuing. The completed portion is preserved.**';
        updateVisibleAnswer(assistantContent);
        break;
      }

      const outcome = await consumeChatStream(
        response,
        assistantContent,
        updateVisibleAnswer,
      );
      assistantContent = outcome.content;
      finishReason = outcome.finishReason;
      receivedDone = outcome.receivedDone;

      if (outcome.streamError) {
        streamInterrupted = true;
        assistantContent += '\n\n⚠️ **The response stream was interrupted. The completed portion is preserved.**';
        updateVisibleAnswer(assistantContent);
        break;
      }

      if (finishReason !== 'length') break;

      if (attempt === MAX_AUTO_CONTINUATIONS) {
        assistantContent += '\n\n⚠️ **Generation reached the configured output limit after automatic continuation.**';
        updateVisibleAnswer(assistantContent);
        break;
      }

      requestMessages = [
        ...newMessages,
        { role: 'assistant', content: assistantContent },
        { role: 'user', content: CONTINUE_PROMPT },
      ];
    }

    if (!streamInterrupted && !receivedDone && !finishReason) {
      assistantContent += '\n\n⚠️ **The response stream ended unexpectedly. The completed portion is preserved.**';
      updateVisibleAnswer(assistantContent);
    }

    const finalContent = assistantContent || '(No response generated)';
    saveSessions(
      updateCurrentSession([
        ...newMessages,
        { role: 'assistant', content: finalContent },
      ]),
    );
  };

  const streamDirectly = async (
    newMessages: Message[],
    updatedTitle: string,
    updateCurrentSession: (msgs: Message[]) => ChatSession[],
  ) => {
    const apiKey = localStorage.getItem('DEEPSEEK_API_KEY') || '';
    if (!apiKey) throw new Error('DeepSeek API Key is missing. Please configure it in Settings.');

    const model = localStorage.getItem('DEEPSEEK_MODEL') || DEFAULT_MODEL;
    const baseUrl = localStorage.getItem('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1';
    const maxTokens = getStoredNumber('DEEPSEEK_MAX_TOKENS', DEFAULT_MAX_TOKENS);
    const temperature = Number(localStorage.getItem('DEEPSEEK_TEMPERATURE') || '0.7');
    const maxContextMessages = getStoredNumber('DEEPSEEK_MAX_CONTEXT', DEFAULT_MAX_CONTEXT_MESSAGES);
    const apiUrl = baseUrl.endsWith('/chat/completions')
      ? baseUrl
      : `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}chat/completions`;

    await streamWithAutomaticContinuation(
      newMessages,
      updatedTitle,
      updateCurrentSession,
      async (requestMessages) => {
        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            messages: formatMessages(requestMessages, maxContextMessages),
            temperature: Number.isFinite(temperature) ? temperature : 0.7,
            max_tokens: maxTokens,
            thinking: { type: 'disabled' },
            stream: true,
          }),
        });

        if (!response.ok) {
          throw new Error(`API Error ${response.status}: ${(await response.text()).slice(0, 500)}`);
        }
        return response;
      },
    );
  };

  const callOcrRoute = async (
    newMessages: Message[],
    updateCurrentSession: (msgs: Message[]) => ChatSession[],
  ) => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: newMessages,
        visionApiKey: localStorage.getItem('VISION_API_KEY') || '',
        visionBaseUrl: localStorage.getItem('VISION_BASE_URL') || 'https://api.openai.com/v1',
        visionModel: localStorage.getItem('VISION_MODEL') || 'gpt-4o-mini',
        mode: 'ocr-only',
      }),
    });

    if (!res.ok) throw new Error((await res.text()) || 'OCR request failed');
    const data = await res.json();
    saveSessions(updateCurrentSession([
      ...newMessages,
      { role: 'assistant', content: data.message || 'No response.' },
    ]));
  };

  const streamViaProxy = async (
    newMessages: Message[],
    updatedTitle: string,
    updateCurrentSession: (msgs: Message[]) => ChatSession[],
  ) => {
    const apiKey = localStorage.getItem('DEEPSEEK_API_KEY') || '';
    const model = localStorage.getItem('DEEPSEEK_MODEL') || DEFAULT_MODEL;
    const baseUrl = localStorage.getItem('DEEPSEEK_BASE_URL') || 'https://api.deepseek.com/v1';
    const maxTokens = getStoredNumber('DEEPSEEK_MAX_TOKENS', DEFAULT_MAX_TOKENS);
    const temperature = Number(localStorage.getItem('DEEPSEEK_TEMPERATURE') || '0.7');
    const maxContextMessages = getStoredNumber('DEEPSEEK_MAX_CONTEXT', DEFAULT_MAX_CONTEXT_MESSAGES);

    await streamWithAutomaticContinuation(
      newMessages,
      updatedTitle,
      updateCurrentSession,
      async (requestMessages) => {
        const cleanedMessages = requestMessages.map((message, index) => (
          index < requestMessages.length - 1 && message.attachments
            ? { ...message, attachments: message.attachments.filter((attachment) => !attachment.type.startsWith('image/')) }
            : message
        ));
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            messages: cleanedMessages,
            clientApiKey: apiKey,
            model,
            baseUrl,
            visionApiKey: localStorage.getItem('VISION_API_KEY') || '',
            visionBaseUrl: localStorage.getItem('VISION_BASE_URL') || 'https://api.openai.com/v1',
            visionModel: localStorage.getItem('VISION_MODEL') || 'gpt-4o-mini',
            mode: 'integrated',
            systemPrompt: activeSession?.systemPrompt,
            maxTokens,
            temperature: Number.isFinite(temperature) ? temperature : 0.7,
            maxContextMessages,
          }),
        });

        if (!res.ok) throw new Error((await res.text()) || 'Proxy request failed');
        return res;
      },
    );
  };

  const sendMessage = async (content: string, attachments: Attachment[] = []) => {
    if (!activeSession || isLoading) return;

    const updatedTitle = messages.length === 0 && !activeSession.isFixedOcr
      ? `${content.slice(0, 20)}${content.length > 20 ? '...' : ''}`
      : activeSession.title;
    const userMessage: Message = { role: 'user', content, attachments };
    const newMessages = [...messages, userMessage];
    const updateCurrentSession = (updatedMessages: Message[]) => sessions.map((session) =>
      session.id === activeSessionId
        ? { ...session, title: updatedTitle, messages: updatedMessages }
        : session,
    );

    saveSessions(updateCurrentSession(newMessages));
    setIsLoading(true);

    try {
      if (activeSession.isFixedOcr) {
        await callOcrRoute(newMessages, updateCurrentSession);
      } else {
        try {
          await streamDirectly(newMessages, updatedTitle, updateCurrentSession);
        } catch (directError: unknown) {
          const message = directError instanceof Error ? directError.message : String(directError);
          if (directError instanceof TypeError || /failed to fetch|networkerror/i.test(message)) {
            console.warn('Direct API call failed; falling back to the streaming proxy.', message);
            await streamViaProxy(newMessages, updatedTitle, updateCurrentSession);
          } else {
            throw directError;
          }
        }
      }
    } catch (error: unknown) {
      console.error(error);
      const message = error instanceof Error ? error.message : String(error);
      saveSessions(updateCurrentSession([...newMessages, { role: 'assistant', content: `**Error**: ${message}` }]));
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
    isOcrMode,
  };
}
