const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'Sage API running' });
});

// Original ReachGPT endpoint — keep working
app.post('/generate', async (req, res) => {
  try {
    const { rawText, pitch } = req.body;

    if (!rawText || rawText.length < 50) {
      return res.status(400).json({ error: 'Not enough profile data' });
    }

    const prompt = `You are an expert cold email writer. A salesperson is viewing a LinkedIn profile and wants to send a personalized cold email.

PROFILE DATA (raw page text):
${rawText.slice(0, 6000)}

THEIR PITCH:
${pitch || 'No pitch provided'}

Write a personalized cold email. Use real signals from the profile. Keep it under 150 words. Be specific, not generic.

Respond in this exact format:
SUBJECT: [subject line]
SIGNAL: [one specific thing from their profile you referenced]
EMAIL:
[the full email]`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 600,
      messages: [{ role: 'user', content: prompt }]
    });

    const text = message.content[0].text;
    res.json({ output: text });

  } catch (err) {
    console.error('Generate error:', err);
    res.status(500).json({ error: err.message });
  }
});

// NEW: Sage universal endpoint — reads any webpage
app.post('/sage', async (req, res) => {
  try {
    const { pageType, suggestedAction, userContext, rawText, url, title } = req.body;

    if (!rawText || rawText.length < 50) {
      return res.status(400).json({ error: 'Not enough page content to read' });
    }

    const prompt = `You are Sage — an AI that reads any webpage and delivers exactly what the user needs based on their context.

PAGE TYPE: ${pageType}
PAGE URL: ${url}
PAGE TITLE: ${title}
PAGE CONTENT (raw text from the page):
${rawText.slice(0, 6000)}

USER CONTEXT (what they typed):
${userContext || 'No context provided'}

INSTRUCTIONS:
Read the user's context carefully and decide what they actually need:

- If they describe who they are or what they're selling (e.g. "I'm a sales rep", "I'm applying for this job", "I'm a founder") → generate the most useful personalized professional action: cold email, cover letter, pitch email, recruiting message, etc.

- If they ask a question or want to learn (e.g. "what does this mean", "teach me", "explain this", "why did this happen", "how does this work") → answer their question clearly and helpfully based on what's on the page. Be a teacher. Be conversational. Use simple language.

- If they ask for a summary (e.g. "summarize", "tldr", "what is this about") → give a clear, concise summary of the page.

- If they give any other instruction → fulfill it intelligently based on the page content.

ALWAYS use real information from the page. Never be generic.

For professional actions: output SUBJECT: [subject] then EMAIL: [clean message body only — no labels, no explanations, ends with [Your name]]

For questions, explanations, summaries: just respond naturally and helpfully. No subject line needed.

Keep all responses under 200 words. Be sharp, specific, and useful.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    });

    const output = message.content[0].text;
    res.json({ output });

  } catch (err) {
    console.error('Sage error:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sage API running on port ${PORT}`));
