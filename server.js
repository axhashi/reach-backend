const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const cors = require('cors');
require('dotenv').config();

const app = express();
app.use(cors());
app.use('/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '2mb' }));

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── UNIQUE CODE STORE ──────────────────────────────────────────────
const codeStore = {};

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = () => Array.from({length:4},()=>chars[Math.floor(Math.random()*chars.length)]).join('');
  let code;
  do { code = `SAGE-${seg()}-${seg()}`; } while (codeStore[code]);
  return code;
}

function createCode(email, credits) {
  const code = generateCode();
  codeStore[code] = { credits, email, used: false, createdAt: new Date().toISOString() };
  console.log(`[CODE CREATED] ${code} → ${email} (${credits} credits)`);
  return code;
}

// ── EMAIL VIA RESEND ───────────────────────────────────────────────
async function sendCodeEmail(email, code, credits) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    console.log(`[EMAIL SKIPPED - no RESEND_API_KEY] Code ${code} for ${email}`);
    return;
  }

  const isUnlimited = credits >= 999;
  const html = `<!DOCTYPE html>
<html>
<body style="background:#0a0a0a;margin:0;padding:40px 20px;font-family:monospace">
<div style="max-width:480px;margin:0 auto;background:#141414;border:1px solid #222;border-radius:12px;padding:40px">
  <div style="font-size:22px;font-weight:900;color:#f0f0f0;margin-bottom:4px">Sa<span style="color:#7fff6e">g</span>e AI</div>
  <div style="font-size:10px;letter-spacing:2px;color:#555;margin-bottom:28px">BROWSER INTELLIGENCE LAYER</div>
  <div style="font-size:18px;font-weight:700;color:#f0f0f0;margin-bottom:8px">Your license code is ready.</div>
  <div style="font-size:12px;color:#888;line-height:1.8;margin-bottom:24px">
    ${isUnlimited ? 'Unlimited access. No action limits.' : `${credits} AI-powered actions. Credits never expire.`}
  </div>
  <div style="font-size:9px;letter-spacing:3px;color:#7fff6e;margin-bottom:10px">YOUR UNIQUE CODE</div>
  <div style="background:#0a0a0a;border:2px solid #7fff6e;border-radius:8px;padding:20px;text-align:center;margin-bottom:6px">
    <div style="font-size:26px;font-weight:700;color:#7fff6e;letter-spacing:5px">${code}</div>
  </div>
  <div style="font-size:10px;color:#555;margin-bottom:24px">This code is unique to you. Single use only.</div>
  <div style="background:#0d0d0d;border:1px solid #1e1e1e;border-radius:8px;padding:20px;margin-bottom:24px">
    <div style="font-size:9px;letter-spacing:2px;color:#555;margin-bottom:12px">HOW TO UNLOCK</div>
    <div style="font-size:11px;color:#888;line-height:2">
      1. Click the Sage icon in Chrome<br>
      2. Paste your code in the license field<br>
      3. Click <strong style="color:#7fff6e">Unlock</strong> — credits activate instantly
    </div>
  </div>
  <div style="font-size:11px;color:#555">Questions? <a href="mailto:support@fanmark.io" style="color:#7fff6e">support@fanmark.io</a></div>
  <div style="margin-top:28px;padding-top:20px;border-top:1px solid #1e1e1e;font-size:10px;color:#333">✦ SAGE AI — Smarter Research, Faster</div>
</div>
</body>
</html>`;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Sage AI <noreply@fanmark.io>',
        to: [email],
        subject: `Your Sage AI code — ${isUnlimited ? 'Unlimited' : `${credits} credits`} unlocked`,
        html
      })
    });
    const data = await res.json();
    console.log(`[EMAIL SENT] ${email} → ${data.id || JSON.stringify(data)}`);
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
  }
}

// ── STRIPE WEBHOOK ─────────────────────────────────────────────────
app.post('/stripe-webhook', async (req, res) => {
  let event;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    if (webhookSecret) {
      const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], webhookSecret);
    } else {
      event = JSON.parse(req.body.toString());
    }
  } catch (err) {
    console.error('[WEBHOOK ERROR]', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[WEBHOOK] ${event.type}`);

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const amount = session.amount_total;

    if (email) {
      const credits = amount >= 2900 ? 999 : 30;
      const code = createCode(email, credits);
      await sendCodeEmail(email, code, credits);
    } else {
      console.log('[WEBHOOK] No email in session:', session.id);
    }
  }

  res.json({ received: true });
});

// ── REDEEM CODE (called by extension) ─────────────────────────────
app.post('/redeem', (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'No code provided' });

  const upper = code.trim().toUpperCase();
  const entry = codeStore[upper];

  if (!entry) {
    return res.status(400).json({ error: 'Invalid code. Check your email after payment.' });
  }
  if (entry.used) {
    return res.status(400).json({ error: 'This code has already been used.' });
  }

  entry.used = true;
  console.log(`[REDEEMED] ${upper} by ${entry.email} (${entry.credits} credits)`);
  res.json({ success: true, credits: entry.credits });
});

// ── ADMIN: manually create a code (for support/refunds) ───────────
app.post('/admin/create-code', (req, res) => {
  if (req.body.secret !== process.env.ADMIN_SECRET) {
    return res.status(403).json({ error: 'Unauthorized' });
  }
  const { email, credits } = req.body;
  const code = createCode(email || 'manual', parseInt(credits) || 30);
  res.json({ code, credits: parseInt(credits) || 30, email });
});

// ── HEALTH ─────────────────────────────────────────────────────────
app.get('/', (req, res) => res.json({ status: 'Sage API running' }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

// ── SUGGEST ────────────────────────────────────────────────────────
app.post('/suggest', async (req, res) => {
  try {
    const { rawText, url, title } = req.body;
    if (!rawText || rawText.length < 30) {
      return res.json({ suggestion: 'Generate the most useful professional action' });
    }
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 60,
      messages: [{ role: 'user', content: `Read this webpage and write ONE sentence (max 12 words) describing the single most useful thing to do for someone viewing it.\n\nURL: ${url}\nTITLE: ${title}\nCONTENT: ${rawText.slice(0, 2000)}\n\nOutput ONLY one sentence. No quotes. Be specific.` }]
    });
    res.json({ suggestion: message.content[0].text.trim() });
  } catch (err) {
    console.error('[SUGGEST ERROR]', err.message);
    res.json({ suggestion: 'Generate the most useful action for this page' });
  }
});

// ── SAGE MAIN ENDPOINT ─────────────────────────────────────────────
app.post('/sage', async (req, res) => {
  try {
    const { pageType, suggestedAction, userContext, rawText, url, title } = req.body;
    if (!rawText || rawText.length < 50) {
      return res.status(400).json({ error: 'Not enough page content' });
    }
    const prompt = `You are Sage — an AI that reads any webpage and delivers exactly what the user needs.

PAGE TYPE: ${pageType}
URL: ${url}
TITLE: ${title}
PAGE CONTENT: ${rawText.slice(0, 6000)}
USER CONTEXT: ${userContext || 'No context provided'}

Read the user context and decide what they need:
- If they describe who they are or what they sell → write a personalized email, cover letter, or pitch
- If they ask a question → answer it clearly based on what's on the page
- If they ask for a summary → summarize concisely
- Otherwise → fulfill their request using the page content

Always use real information from the page. Never be generic.
For emails: output SUBJECT: [line] then EMAIL: [body ending with [Your name]]
For everything else: respond naturally and helpfully.
Keep responses under 200 words. Be sharp and specific.`;

    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 800,
      messages: [{ role: 'user', content: prompt }]
    });
    res.json({ output: message.content[0].text });
  } catch (err) {
    console.error('[SAGE ERROR]', err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sage API running on port ${PORT}`));
