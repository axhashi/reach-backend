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

    const prompt = `You are Sage — an AI that reads any webpage and generates the most useful professional action based on what's on that page.

PAGE TYPE: ${pageType}
PAGE URL: ${url}
PAGE TITLE: ${title}
SUGGESTED ACTION: ${suggestedAction}

PAGE CONTENT (raw text from the page):
${rawText.slice(0, 6000)}

USER CONTEXT (who they are and what they want):
${userContext || 'No context provided — use best judgment based on the page type'}

INSTRUCTIONS:
- Generate the most useful, specific, personalized professional output for this page
- Use real information from the page — names, companies, specific details, recent work
- Never be generic. If it's a job posting, reference the actual role and company. If it's a LinkedIn profile, reference their actual experience. If it's an investor page, reference their actual portfolio.
- Keep it concise and immediately usable — under 200 words
- For emails: include a subject line. For other outputs: format appropriately.
- Sound human, warm, and specific — not like a template

Generate the output now:`;

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
