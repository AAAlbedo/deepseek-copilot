import { NextResponse } from 'next/server';

const DEFAULT_SYSTEM_PROMPT = "你是一个专业的学术与数理分析助手，精通复杂的数学计算、逻辑推理和文档分析。回答要条理清晰、准确直接。";
const VISION_SYSTEM_PROMPT = "You are an advanced OCR and Image Analysis tool. Extract all text, mathematical formulas, tables, and describe the key visual elements of the image in detailed Markdown format.不要修改原文，直接输出结果即可";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { 
      messages, clientApiKey, model, baseUrl,
      visionApiKey, visionBaseUrl, visionModel, mode, systemPrompt
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
        // Handle Google Gemini Native REST API
        const targetModel = visionModel || 'gemini-1.5-flash';
        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`;

        const parts: any[] = [{ text: VISION_SYSTEM_PROMPT }];
        
        for (const imgDataUri of imageAttachments) {
          // Extract mimeType and raw base64 string
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
        // Handle OpenAI Compatible Endpoint
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

      // If OCR-only mode, return the vision result directly
      if (mode === 'ocr-only') {
        return NextResponse.json({
          message: visionExtractedText
        });
      }
    }

    // --- STAGE 2: DeepSeek Reasoning ---
    if (!apiKey) {
      return new NextResponse('DeepSeek API Key is missing. Please configure it.', { status: 401 });
    }

    const formattedMessages = [
      { role: 'system', content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
    ];

    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i];
      let content = msg.content;
      
      if (msg.attachments && msg.attachments.length > 0) {
        for (const att of msg.attachments) {
          if (att.type === 'pdf' || att.type === 'docx') {
            content += `\n\n--- Document Attached (${att.name}) ---\n${att.content}\n--- End of Document ---`;
          }
        }
      }

      // If this is the last message and we extracted vision text, append it
      if (i === messages.length - 1 && visionExtractedText) {
        content += `\n\n--- Image Extracted Content (OCR) ---\n${visionExtractedText}\n--- End of Image Content ---`;
      }
      
      formattedMessages.push({ role: msg.role, content });
    }

    const payload = {
      model: model || 'deepseek-v4-pro',
      messages: formattedMessages,
      temperature: 0.7,
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

    const data = await response.json();
    
    return NextResponse.json({
      message: data.choices[0]?.message?.content || ''
    });

  } catch (error: any) {
    console.error('API Chat Route Error:', error);
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}
