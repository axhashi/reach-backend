const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');

require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const users = {};
function getUser(email) {
  if (!users[email]) users[email] = { credits: 5 };
  return users[email];
}

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

app.get('/credits', (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'Email required' });
  res.json({ credits: getUser(email).credits });
});

app.post('/generate', async (req, res) => {
  const { email, profileData, pitch } = req.body;
  if (!email || !profileData || !pitch) return res.status(400).json({ error: 'Missing fields' });

  const user = getUser(email);
  if (user.credits <= 0) return res.status(402).json({ error: 'No credits remaining.', credits: 0 });

  const { name, headline, location, experiences, posts, about } = profileData;

  try {
    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      system: `You are ReachGPT, a cold email assistant. Use ONLY the real scraped data — never invent signals.

Respond in this EXACT plain text format:
SUBJECT: [subject line]
SIGNAL: [real signal from their profile]
SIGNAL: [another real signal]
SIGNAL: [another real signal]
EMAIL:
[4 short paragraphs, under 150 words, opens with hook from real data, ends with soft CTA, sign off as [Your name]]`,
      messages: [{
        role: 'user',
        content: `Name: ${name || 'Unknown'}
Headline: ${headline || ''}
Location: ${location || ''}
Experience: ${(experiences || []).join('; ')}
About: ${about || ''}
Recent posts: ${(posts || []).map((p, i) => `Post ${i+1}: "${p}"`).join('\n') || 'None'}

My pitch: ${pitch}`
      }]
    });

    const raw = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = parseEmail(raw);
    if (!parsed.email) return res.status(500).json({ error: 'Generation failed' });

    user.credits -= 1;
    res.json({ ...parsed, creditsRemaining: user.credits });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`ReachGPT API running on port ${PORT}`));
