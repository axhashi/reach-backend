const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

function parseEmail(text) {
  const lines = text.split('\n');
  let subject = '', signals = [], emailLines = [], inEmail = false;
  for (const line of lines) {
    const t = line.trim();
    if (t.toUpperCase().startsWith('SUBJECT:')) subject = t.replace(/^SUBJECT:\s*/i, '').trim();
    else if (t.toUpperCase().startsWith('SIGNAL:')) signals.push(t.replace(/^SIGNAL:\s*/i, '').trim());
    else if (t.toUpperCase() === 'EMAIL:') inEmail = true;
    else if (inEmail) emailLines.push(line);
  }
  return { subject: subject || 'Quick note', signals, email: emailLines.join('\n').trim() };
}

app.get('/', (req, res) => res.json({ status: 'ReachGPT API running' }));

app.post('/generate', async (req, res) => {
  const { profileData, pitch } = req.body;
  if (!profileData || !pitch) return res.status(400).json({ error: 'Missing profileData and pitch' });

  const { name, rawText } = profileData;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1000,
      system: `You are ReachGPT, a cold email assistant. You will receive raw text scraped from a LinkedIn profile page and a product pitch.

Extract the key signals from the profile text: job title, company, recent posts, certifications, career changes.

Then write a hyper-personalized cold email that opens with a SPECIFIC hook from something real on their profile.

NEVER write generic openers like "I noticed your profile" — always reference something specific.

Respond in this EXACT plain text format:
SUBJECT: [subject line]
SIGNAL: [specific real thing from their profile]
SIGNAL: [another signal]
SIGNAL: [another signal]
EMAIL:
[4 short paragraphs under 150 words, specific opening hook, soft CTA, sign off as [Your name]]`,
      messages: [{
        role: 'user',
        content: `Profile name: ${name || 'Unknown'}
Profile URL: ${profileData.profileUrl || ''}

Raw profile text:
${rawText || 'No profile text available'}

My pitch: ${pitch}`
      }]
    });

    const raw = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = parseEmail(raw);
    if (!parsed.email) return res.status(500).json({ error: 'Generation failed — empty response' });

    res.json({ ...parsed });

  } catch (err) {
    console.error('Error:', err.message);
    res.status(500).json({ error: err.message, status: err.status });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ReachGPT API running on port ${PORT}`));
