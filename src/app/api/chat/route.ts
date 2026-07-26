import { NextResponse } from 'next/server';

// Long answer streams should not be constrained by the 60 second Edge runtime
// timeout that previously cut off proxy requests.
export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const DEFAULT_MODEL = 'deepseek-v4-pro';
const DEFAULT_MAX_TOKENS = 65536;
const DEFAULT_SYSTEM_PROMPT =
  '你是一个专业的学术与数理分析助手，精通复杂的数学计算、逻辑推理和文档分析。回答要条理清晰、准确直接。';
const VISION_SYSTEM_PROMPT =
  'You are an advanced OCR and Image Analysis tool. Extract all text, mathematical formulas, tables, and key visual elements in detailed Markdown. Do not alter source text; return the extracted result directly.';

type Attachment = { name: string; type: string; content: string };
type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  attachments?: Attachment[];
};

function completionUrl(baseUrl: string) {
  if (baseUrl.endsWith('/chat/completions')) return baseUrl;
  return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}chat/completions`;
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const messages: ChatMessage[] = Array.isArray(body.messages) ? body.messages : [];
    const {
      clientApiKey,
      model,
      baseUrl,
      visionApiKey,
      visionBaseUrl,
      visionModel,
      mode,
      systemPrompt,
      maxTokens,
      temperature: clientTemperature,
      maxContextMessages,
    } = body;

    const apiKey = clientApiKey || process.env.DEEPSEEK_API_KEY;
    const vApiKey = visionApiKey || process.env.VISION_API_KEY;
    const lastMessage = messages.at(-1);
    const imageAttachments = (lastMessage?.role === 'user' ? lastMessage.attachments || [] : [])
      .filter((attachment) => attachment.type.startsWith('image/'));
    const hasImage = imageAttachments.length > 0;
    let visionExtractedText = '';

    if (hasImage && vApiKey) {
      const visionUrl = visionBaseUrl || 'https://api.openai.com/v1';
      const isGeminiNative = visionUrl.includes('generativelanguage.googleapis.com')
        && (visionUrl.includes('generateContent') || !visionUrl.includes('/openai'));

      if (isGeminiNative) {
        const targetModel = visionModel || 'gemini-1.5-flash';
        const parts: Array<Record<string, unknown>> = [{ text: VISION_SYSTEM_PROMPT }];
        for (const image of imageAttachments) {
          const matches = image.content.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (matches) {
            parts.push({ inline_data: { mime_type: matches[1], data: matches[2] } });
          }
        }

        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-goog-api-key': vApiKey },
            body: JSON.stringify({ contents: [{ parts }] }),
            cache: 'no-store',
            signal: request.signal,
          },
        );
        if (!response.ok) {
          return new NextResponse(`Gemini Vision Error: ${response.status} - ${await response.text()}`, { status: response.status });
        }
        const data = await response.json();
        visionExtractedText = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      } else {
        const visionContent = [
          { type: 'text', text: VISION_SYSTEM_PROMPT },
          ...imageAttachments.map((image) => ({ type: 'image_url', image_url: { url: image.content } })),
        ];
        const response = await fetch(completionUrl(visionUrl), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${vApiKey}` },
          body: JSON.stringify({
            model: visionModel || 'gpt-4o-mini',
            messages: [{ role: 'user', content: visionContent }],
            max_tokens: 2000,
          }),
          cache: 'no-store',
          signal: request.signal,
        });
        if (!response.ok) {
          return new NextResponse(`Vision API Error: ${response.status} - ${await response.text()}`, { status: response.status });
        }
        const data = await response.json();
        visionExtractedText = data.choices?.[0]?.message?.content || '';
      }
    }

    if (mode === 'ocr-only') {
      return NextResponse.json({
        message: hasImage ? visionExtractedText : '请上传图片以使用纯 OCR 提取模式。',
      });
    }

    if (!apiKey) return new NextResponse('DeepSeek API Key is missing.', { status: 401 });

    const requestedContext = Number(maxContextMessages);
    const contextLimit = Number.isFinite(requestedContext) && requestedContext > 0
      ? Math.floor(requestedContext)
      : 100;
    const trimmed = messages.length > contextLimit ? messages.slice(-contextLimit) : messages;
    const formattedMessages: Array<Record<string, string>> = [
      { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
    ];

    for (let index = 0; index < trimmed.length; index += 1) {
      const message = trimmed[index];
      let content = message.content || '';
      for (const attachment of message.attachments || []) {
        if (attachment.type === 'pdf' || attachment.type === 'docx') {
          content += `\n\n--- Document (${attachment.name}) ---\n${attachment.content}\n--- End ---`;
        }
      }
      if (index === trimmed.length - 1 && visionExtractedText) {
        content += `\n\n--- OCR Content ---\n${visionExtractedText}\n--- End ---`;
      }

      formattedMessages.push({ role: message.role, content });
    }

    const requestedTokens = Number(maxTokens);
    const response = await fetch(completionUrl(baseUrl || 'https://api.deepseek.com/v1'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: formattedMessages,
        temperature: typeof clientTemperature === 'number' ? clientTemperature : 0.7,
        max_tokens: Number.isFinite(requestedTokens) && requestedTokens > 0
          ? requestedTokens
          : DEFAULT_MAX_TOKENS,
        // V4 Pro enables thinking by default. Disabling it here is the only
        // way to keep its hidden chain-of-thought from consuming the response
        // budget; hiding a UI panel cannot change upstream token use.
        thinking: { type: 'disabled' },
        stream: true,
      }),
      cache: 'no-store',
      signal: request.signal,
    });

    if (!response.ok) {
      return new NextResponse(`DeepSeek Error: ${response.status} - ${await response.text()}`, { status: response.status });
    }
    if (!response.body) return new NextResponse('DeepSeek returned no response stream.', { status: 502 });

    const encoder = new TextEncoder();
    const heartbeat = encoder.encode(': heartbeat\n\n');
    const upstreamReader = response.body.getReader();
    let timer: ReturnType<typeof setInterval> | null = null;
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const resetHeartbeat = () => {
          if (timer) clearInterval(timer);
          timer = setInterval(() => {
            try {
              controller.enqueue(heartbeat);
            } catch {
              if (timer) clearInterval(timer);
            }
          }, 10000);
        };

        resetHeartbeat();
        try {
          while (true) {
            const { done, value } = await upstreamReader.read();
            if (done) break;
            controller.enqueue(value);
            resetHeartbeat();
          }
        } catch (error) {
          console.error('Upstream chat stream error:', error);
        } finally {
          if (timer) clearInterval(timer);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      async cancel(reason) {
        if (timer) clearInterval(timer);
        closed = true;
        await upstreamReader.cancel(reason);
      },
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Content-Encoding': 'none',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error: unknown) {
    console.error('API Route Error:', error);
    const message = error instanceof Error ? error.message : String(error);
    return new NextResponse(`Internal Server Error: ${message}`, { status: 500 });
  }
}
