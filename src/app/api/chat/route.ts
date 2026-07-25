import { NextResponse } from 'next/server';

export const runtime = 'edge';
export const maxDuration = 300;

const DEFAULT_SYSTEM_PROMPT = "你是一个专业的学术与数理分析助手，精通复杂的数学计算、逻辑推理和文档分析。回答要条理清晰、准确直接。";
const VISION_SYSTEM_PROMPT = "You are an advanced OCR and Image Analysis tool. Extract all text, mathematical formulas, tables, and describe the key visual elements of the image in detailed Markdown format.不要修改原文，直接输出结果即可";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      messages, clientApiKey, model, baseUrl,
      visionApiKey, visionBaseUrl, visionModel, mode, systemPrompt,
      maxTokens, temperature: clientTemperature, maxContextMessages
    } = body;

    const apiKey = clientApiKey || process.env.DEEPSEEK_API_KEY;
    const vApiKey = visionApiKey || process.env.VISION_API_KEY;

    let apiUrl = baseUrl || 'https://api.deepseek.com/v1';
    if (!apiUrl.endsWith('/chat/completions')) {
      apiUrl = apiUrl.endsWith('/') ? `${apiUrl}chat/completions` : `${apiUrl}/chat/completions`;
    }

    const lastMessage = messages[messages.length - 1];
    let hasImage = false;
    const imageAttachments = [];

    if (lastMessage.role === 'user' && lastMessage.attachments) {
      for (const att of lastMessage.attachments) {
        if (att.type.startsWith('image/')) {
          hasImage = true;
          imageAttachments.push(att.content);
        }
      }
    }

    let visionExtractedText = "";

    // --- STAGE 1: Vision Processing ---
    if (hasImage) {
      if (!vApiKey) {
        return new NextResponse('Vision API Key is missing. Please provide it in Settings to process images.', { status: 400 });
      }

      const vRawUrl = visionBaseUrl || 'https://api.openai.com/v1';
      const isGeminiNative = vRawUrl.includes('generativelanguage.googleapis.com') && (vRawUrl.includes('generateContent') || !vRawUrl.includes('/openai'));

      if (isGeminiNative) {
        const targetModel = visionModel || 'gemini-1.5-flash';
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;

        const parts: any[] = [{ text: VISION_SYSTEM_PROMPT }];
        
        for (const imgDataUri of imageAttachments) {
          const matches = imgDataUri.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
          if (matches) {
            parts.push({
              inline_data: {
                mime_type: matches[1],
                data: matches[2]
              }
            });
          }
        }

        const gRes = await fetch(geminiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-goog-api-key': vApiKey
          },
          body: JSON.stringify({
            contents: [{ parts }]
          })
        });

        if (!gRes.ok) {
          const err = await gRes.text();
          console.error('Gemini Vision API Error:', err);
          return new NextResponse(`Gemini Vision API Error: ${gRes.status} - ${err}`, { status: gRes.status });
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
          visionContentParts.push({
            type: 'image_url',
            image_url: { url: imgUrl }
          });
        }

        const visionPayload = {
          model: visionModel || 'gpt-4o-mini',
          messages: [{ role: 'user', content: visionContentParts }],
          max_tokens: 2000
        };

        const vRes = await fetch(vApiUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${vApiKey}`
          },
          body: JSON.stringify(visionPayload)
        });

        if (!vRes.ok) {
          const err = await vRes.text();
          console.error('Vision API Error:', err);
          return new NextResponse(`Vision API Error: ${vRes.status} - ${err}`, { status: vRes.status });
        }

        const vData = await vRes.json();
        visionExtractedText = vData.choices?.[0]?.message?.content || "";
      }
    }

    // If OCR-only mode, return the vision result directly
    if (mode === 'ocr-only') {
      return NextResponse.json({
        message: hasImage ? visionExtractedText : "请上传图片以使用纯OCR提取模式。"
      });
    }

    // --- STAGE 2: DeepSeek Reasoning ---
    if (!apiKey) {
      return new NextResponse('DeepSeek API Key is missing. Please configure it.', { status: 401 });
    }

    const formattedMessages = [
      { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
    ];

    // Apply context window limit: only send the last N messages
    const contextLimit = maxContextMessages || 50;
    const trimmedMessages = messages.length > contextLimit 
      ? messages.slice(-contextLimit)
      : messages;

    for (let i = 0; i < trimmedMessages.length; i++) {
      const msg = trimmedMessages[i];
      let content = msg.content;
      
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.type === 'pdf' || att.type === 'docx') {
            content += `\n\n--- Document Attached (${att.name}) ---\n${att.content}\n--- End of Document ---`;
          }
          // Skip image attachments (Base64) — they're huge and would blow the context window
        }
      }

      // If this is the last message and we extracted vision text, append it
      if (i === trimmedMessages.length - 1 && visionExtractedText) {
        content += `\n\n--- Image Extracted Content (OCR) ---\n${visionExtractedText}\n--- End of Image Content ---`;
      }
      
      formattedMessages.push({ role: msg.role, content });
    }

    const resolvedTemperature = clientTemperature !== undefined ? clientTemperature : 0.7;
    const resolvedMaxTokens = maxTokens || 8192;

    const payload = {
      model: model || 'deepseek-v4-pro',
      messages: formattedMessages,
      temperature: resolvedTemperature,
      max_tokens: resolvedMaxTokens,
      stream: true,
    };

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('DeepSeek API Error:', errorText);
      return new NextResponse(`DeepSeek API Error: ${response.status} - ${errorText}`, { status: response.status });
    }

    // --- CRITICAL: Create a heartbeat-wrapped stream ---
    // During DeepSeek's "thinking" phase (deep reasoning models), no SSE data flows.
    // Vercel Edge detects an idle connection and kills it, causing FUNCTION_INVOCATION_TIMEOUT.
    // Solution: Send SSE comment heartbeats (`: heartbeat\n\n`) every 10 seconds.
    // SSE comments are ignored by compliant clients but keep the Vercel connection alive.
    const encoder = new TextEncoder();
    const heartbeatData = encoder.encode(': heartbeat\n\n');
    const upstreamReader = response.body!.getReader();

    const stream = new ReadableStream({
      async start(controller) {
        let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

        const resetHeartbeat = () => {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          heartbeatTimer = setInterval(() => {
            try {
              controller.enqueue(heartbeatData);
            } catch {
              // Controller closed, stop heartbeat
              if (heartbeatTimer) clearInterval(heartbeatTimer);
            }
          }, 10000); // Send heartbeat every 10 seconds
        };

        resetHeartbeat();

        try {
          while (true) {
            const { done, value } = await upstreamReader.read();
            if (done) break;
            // Forward upstream data and reset heartbeat timer
            controller.enqueue(value);
            resetHeartbeat();
          }
        } catch (err) {
          console.error('Stream read error:', err);
        } finally {
          if (heartbeatTimer) clearInterval(heartbeatTimer);
          controller.close();
        }
      }
    });

    return new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      }
    });

  } catch (error: any) {
    console.error('API Chat Route Error:', error);
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}
