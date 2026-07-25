import { NextResponse } from 'next/server';

export const runtime = 'edge';

const VISION_SYSTEM_PROMPT = "You are an advanced OCR and Image Analysis tool. Extract all text, mathematical formulas, tables, and describe the key visual elements of the image in detailed Markdown format.不要修改原文，直接输出结果即可";

// This route now ONLY handles OCR/Vision requests.
// Normal chat streaming is done directly from the browser to avoid Vercel timeout limits.
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { messages, visionApiKey, visionBaseUrl, visionModel, mode } = body;

    if (mode !== 'ocr-only') {
      return NextResponse.json({ message: 'This route only handles OCR mode.' }, { status: 400 });
    }

    const vApiKey = visionApiKey || process.env.VISION_API_KEY;
    if (!vApiKey) {
      return new NextResponse('Vision API Key is missing.', { status: 400 });
    }

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

    if (!hasImage) {
      return NextResponse.json({ message: "请上传图片以使用纯OCR提取模式。" });
    }

    const vRawUrl = visionBaseUrl || 'https://api.openai.com/v1';
    const isGeminiNative = vRawUrl.includes('generativelanguage.googleapis.com') && (vRawUrl.includes('generateContent') || !vRawUrl.includes('/openai'));

    let visionExtractedText = "";

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
        body: JSON.stringify({
          model: visionModel || 'gpt-4o-mini',
          messages: [{ role: 'user', content: visionContentParts }],
          max_tokens: 2000
        })
      });

      if (!vRes.ok) {
        const err = await vRes.text();
        return new NextResponse(`Vision API Error: ${vRes.status} - ${err}`, { status: vRes.status });
      }

      const vData = await vRes.json();
      visionExtractedText = vData.choices?.[0]?.message?.content || "";
    }

    return NextResponse.json({ message: visionExtractedText });

  } catch (error: any) {
    console.error('OCR Route Error:', error);
    return new NextResponse(`Internal Server Error: ${error.message}`, { status: 500 });
  }
}
