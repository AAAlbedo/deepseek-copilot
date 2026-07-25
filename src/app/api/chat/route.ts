import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 60;

const DEFAULT_SYSTEM_PROMPT = "你是一个专业的学术与数理分析助手，精通复杂的数学计算、逻辑推理和文档分析。回答要条理清晰、准确直接。";
const VISION_SYSTEM_PROMPT = "You are an advanced OCR and Image Analysis tool. Extract all text, mathematical formulas, tables, and describe the key visual elements of the image in detailed Markdown format.不要修改原文，直接输出结果即可";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const {
      messages, clientApiKey, model, baseUrl,
      visionApiKey, visionBaseUrl, visionModel, mode, systemPrompt,
      maxTokens, temperature: clientTemperature, maxContextMessages,
      thinkingEnabled
    } = body;

    const apiKey = clientApiKey || process.env.DEEPSEEK_API_KEY;
    const vApiKey = visionApiKey || process.env.VISION_API_KEY;

    // ─── Vision / OCR Processing ───
    const lastMessage = messages[messages.length - 1];
    let hasImage = false;
    const imageAttachments: string[] = [];

    if (lastMessage.role === 'user' && lastMessage.attachments) {
      for (const att of lastMessage.attachments) {
        if (att.type.startsWith('image/')) {
          hasImage = true;
          imageAttachments.push(att.content);
        }
      }
    }

    let visionExtractedText = "";

    if (hasImage && vApiKey) {
      const vRawUrl = visionBaseUrl || 'https://api.openai.com/v1';
      const isGeminiNative = vRawUrl.includes('generativelanguage.googleapis.com') && (vRawUrl.includes('generateContent') || !vRawUrl.includes('/openai'));

      if (isGeminiNative) {
        const targetModel = visionModel || 'gemini-1.5-flash';
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;
        const parts: any[] = [{ text: VISION_SYSTEM_PROMPT }];
        for (const imgDataUri of imageAttachments) {
          const matches = imgDataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (matches) {
            parts.push({ inline_data: { mime_type: matches[1], data: matches[2] } });
          }
        }
        const gRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-goog-api-key': vApiKey },
          body: JSON.stringify({ contents: [{ parts }] })
        });
        if (!gRes.ok) {
          const err = await gRes.text();
          return new NextResponse(`Gemini Vision Error: ${gRes.status} - ${err}`, { status: gRes.status });
        }
        const gData = await gRes.json();
        visionExtractedText = gData.candidates?.[0]?.content?.parts?.[0]?.text || "";
      } else {
        let vApiUrl = vRawUrl;
        if (!vApiUrl.endsWith('/chat/completions')) {
          vApiUrl = vApiUrl.endsWith('/') ? `${vApiUrl}chat/completions` : `${vApiUrl}/chat/completions`;
        }
        const visionContentParts: any[] = [{ type: 'text', text: VISION_SYSTEM_PROMPT }];
        for (const imgUrl of imageAttachments) {
          visionContentParts.push({ type: 'image_url', image_url: { url: imgUrl } });
        }
        const vRes = await fetch(vApiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${vApiKey}` },
          body: JSON.stringify({ model: visionModel || 'gpt-4o-mini', messages: [{ role: 'user', content: visionContentParts }], max_tokens: 2000 })
        });
        if (!vRes.ok) {
          const err = await vRes.text();
          return new NextResponse(`Vision API Error: ${vRes.status} - ${err}`, { status: vRes.status });
        }
        const vData = await vRes.json();
        visionExtractedText = vData.choices?.[0]?.message?.content || "";
      }
    }

    // OCR-only mode: return result immediately
    if (mode === 'ocr-only') {
      return NextResponse.json({
        message: hasImage ? visionExtractedText : "请上传图片以使用纯OCR提取模式。"
      });
    }

    // ─── Chat Streaming (fallback proxy for CORS-blocked direct calls) ───
    if (!apiKey) {
      return new NextResponse('DeepSeek API Key is missing.', { status: 401 });
    }

    let apiUrl = baseUrl || 'https://api.deepseek.com/v1';
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl.endsWith('/') ? `${apiUrl}chat/completions` : `${apiUrl}/chat/completions`;
    }

    const formattedMessages = [
      { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
    ];

    const contextLimit = maxContextMessages || 50;
    const trimmed = messages.length > contextLimit ? messages.slice(-contextLimit) : messages;

    for (let i = 0; i < trimmed.length; i++) {
      const msg = trimmed[i];
      let content = msg.content;
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.type === 'pdf' || att.type === 'docx') {
            content += `\n\n--- Document (${att.name}) ---\n${att.content}\n--- End ---`;
          }
        }
      }
      if (i === trimmed.length - 1 && visionExtractedText) {
        content += `\n\n--- OCR Content ---\n${visionExtractedText}\n--- End ---`;
      }
      formattedMessages.push({ role: msg.role, content });
    }

    const apiPayload: Record<string, unknown> = {
      model: model || 'deepseek-chat',
      messages: formattedMessages,
      temperature: clientTemperature ?? 0.7,
      max_tokens: maxTokens || 8192,
      stream: true,
    };

    // We do not pass ANY reasoning parameters at all.
    // This perfectly matches Obsidian Copilot's behavior.

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(apiPayload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return new NextResponse(`DeepSeek Error: ${response.status} - ${errorText}`, { status: response.status });
    }

    // Pipe stream with heartbeat to prevent Vercel timeout
    const encoder = new TextEncoder();
    const heartbeat = encoder.encode(': heartbeat\n\n');
    const upstreamReader = response.body!.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        let timer: ReturnType<typeof setInterval> | null = setInterval(() => {
          try { controller.enqueue(heartbeat); } catch { if (timer) clearInterval(timer); }
        }, 10000);

        try {
          while (true) {
            const { done, value } = await upstreamReader.read();
            if (done) break;
            controller.enqueue(value);
            // Reset heartbeat timer on data received
            if (timer) clearInterval(timer);
            timer = setInterval(() => {
              try { controller.enqueue(heartbeat); } catch { if (timer) clearInterval(timer); }
            }, 10000);
          }
        } catch (err) {
          console.error('Stream error:', err);
        } finally {
          if (timer) clearInterval(timer);
          controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'X-Accel-Buffering': 'no',
      }
    });

  } catch (error: any) {
    console.error('API Route Error:', error);
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}
