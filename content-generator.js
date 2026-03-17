// scripts/content-generator.js
// Generates structured carousel content via Google AI Studio (Gemini API — free tier)
// Get your free API key at: https://aistudio.google.com/apikey

import { CONFIG } from './config.js';

const GEMINI_MODEL = 'gemini-2.5-flash-preview-04-17';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const SYSTEM_PROMPT = `You are the content strategist for The London Choral Service — a premium provider of live choral music for funerals, weddings, memorial services, and ceremonies across London and the South East.

Your audience: families planning funerals or memorial services, wedding couples, and funeral directors. The tone is warm, authoritative, and reassuring — never salesy or pushy. You speak as trusted experts who understand that music is deeply personal and emotionally significant.

Brand voice:
- Warm but professional — like a knowledgeable friend in the music world
- Empathetic and sensitive when discussing bereavement
- Quietly confident about expertise — never boastful
- Practical and helpful — always give people something useful
- British English throughout

You generate carousel/infographic post content as structured JSON. Each carousel has exactly ${CONFIG.slideCount} slides:

Slide 1: HOOK — a compelling headline that stops the scroll. Short, punchy, emotionally resonant.
Slides 2–${CONFIG.slideCount - 1}: CONTENT — one clear point per slide. Each has a headline (max 8 words) and body text (max 30 words). Include a relevant icon suggestion (emoji).
Slide ${CONFIG.slideCount}: CTA — a gentle call to action. Never hard-sell. Always end with the website URL and a warm invitation.

CRITICAL: Return ONLY valid JSON. No markdown, no backticks, no preamble, no explanation. The JSON must match this exact schema:

{
  "topic": "string — the carousel topic",
  "caption": "string — the social media caption/description (max 200 chars, include 3-5 relevant hashtags)",
  "slides": [
    {
      "type": "hook | content | cta",
      "icon": "string — single emoji",
      "headline": "string — max 8 words",
      "body": "string — max 30 words (empty string for hook slides)",
      "footnote": "string — optional small text at bottom of slide"
    }
  ]
}`;

export async function generateCarouselContent(topic) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not set. Get a free key at https://aistudio.google.com/apikey');

  const selectedTopic = topic || CONFIG.topics[Math.floor(Math.random() * CONFIG.topics.length)];

  const url = `${GEMINI_BASE_URL}/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: `Generate a ${CONFIG.slideCount}-slide carousel for The London Choral Service on the topic: "${selectedTopic}". Return ONLY the JSON object, nothing else.`,
            },
          ],
        },
      ],
      systemInstruction: {
        parts: [{ text: SYSTEM_PROMPT }],
      },
      generationConfig: {
        temperature: 0.8,
        maxOutputTokens: 2000,
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!res.ok) {
    const errBody = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${errBody}`);
  }

  const data = await res.json();

  // Extract text from Gemini's response structure
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!text) {
    throw new Error(`No content in Gemini response: ${JSON.stringify(data).substring(0, 500)}`);
  }

  // Clean and parse
  const cleaned = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();

  try {
    const content = JSON.parse(cleaned);

    // Validate structure
    if (!content.slides || content.slides.length !== CONFIG.slideCount) {
      throw new Error(`Expected ${CONFIG.slideCount} slides, got ${content.slides?.length || 0}`);
    }

    console.log(`✓ Generated content: "${content.topic}" (${content.slides.length} slides)`);
    return content;
  } catch (err) {
    console.error('Failed to parse Gemini response:', err.message);
    console.error('Raw response:', text.substring(0, 500));
    throw err;
  }
}
