// Reach Extension — direct API, no backend needed
let profileData = null;

const STATES = ['wrongpage','loading','form','generating','result'];
function show(s) { STATES.forEach(x => document.getElementById(`state-${x}`).classList.toggle('active', x === s)); }

function parse(text) {
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

async function init() {
  show('loading');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab.url?.includes('linkedin.com/in/')) { show('wrongpage'); return; }

  try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] }); } catch {}
  await new Promise(r => setTimeout(r, 2500)); // wait for LinkedIn JS to fully render

  try { profileData = await chrome.tabs.sendMessage(tab.id, { action: 'scrapeProfile' }); }
  catch { profileData = {}; }

  // Try multiple selectors for name
  const nameFromUrl = (tab.url.match(/linkedin\.com\/in\/([^/?#]+)/) || [])[1]?.replace(/-/g,' ') || 'Unknown';
  const name = profileData?.name || nameFromUrl;

  document.getElementById('prospect-name').textContent = name;
  document.getElementById('prospect-title').textContent =
    [profileData?.headline, profileData?.location].filter(Boolean).join(' · ') || 'LinkedIn profile';

  if (profileData?.posts?.length > 0) {
    document.getElementById('signals-container').style.display = 'block';
    profileData.posts.slice(0,2).forEach(post => {
      const c = document.createElement('div'); c.className = 'sig';
      c.textContent = '↗ ' + post.slice(0,60) + (post.length > 60 ? '...' : '');
      document.getElementById('signals-row').appendChild(c);
    });
  }

  const saved = await chrome.storage.local.get(['pitch','apiKey']);
  if (saved.pitch) document.getElementById('pitch-input').value = saved.pitch;
  if (saved.apiKey) document.getElementById('api-key-input').value = saved.apiKey;
  show('form');
}

document.getElementById('generate-btn').addEventListener('click', async () => {
  const pitch = document.getElementById('pitch-input').value.trim();
  const apiKey = document.getElementById('api-key-input').value.trim();
  const errEl = document.getElementById('form-error');
  errEl.style.display = 'none';

  if (!pitch) { errEl.textContent = 'Please enter your pitch.'; errEl.style.display = 'block'; return; }
  if (!apiKey) { errEl.textContent = 'Please enter your Anthropic API key.'; errEl.style.display = 'block'; return; }

  await chrome.storage.local.set({ pitch, apiKey });
  show('generating');

  const name = profileData?.name || 'this person';
  const headline = profileData?.headline || '';
  const location = profileData?.location || '';
  const experiences = (profileData?.experiences || []).join('; ');
  const posts = (profileData?.posts || []).map((p,i) => `Post ${i+1}: "${p}"`).join('\n') || 'No posts found';
  const about = profileData?.about || '';

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: `You are Reach, a cold email assistant. Use ONLY the real scraped data provided — never invent signals.

Respond in this EXACT plain text format:
SUBJECT: [subject line]
SIGNAL: [real signal from their profile]
SIGNAL: [another real signal]
SIGNAL: [another real signal]
EMAIL:
[4 short paragraphs, under 150 words, opens with a hook from their real data, ends with soft CTA, sign off as [Your name]]`,
        messages: [{
          role: 'user',
          content: `Name: ${name}
Headline: ${headline}
Location: ${location}
Experience: ${experiences}
About: ${about}
Recent posts:
${posts}

My pitch: ${pitch}`
        }]
      })
    });

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);

    const raw = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const parsed = parse(raw);
    if (!parsed.email) throw new Error('Generation failed. Try again.');

    document.getElementById('result-name').textContent = `// EMAIL → ${name}`;
    document.getElementById('result-subject').textContent = parsed.subject;
    document.getElementById('result-email').textContent = parsed.email;

    // Show signals
    if (parsed.signals.length > 0) {
      const row = document.getElementById('signals-row');
      row.innerHTML = '';
      parsed.signals.forEach(s => {
        const c = document.createElement('div'); c.className = 'sig';
        c.textContent = '↗ ' + s;
        row.appendChild(c);
      });
      document.getElementById('signals-container').style.display = 'block';
    }

    show('result');
  } catch(e) {
    show('form');
    document.getElementById('form-error').textContent = '⚠ ' + (e.message || 'Something went wrong.');
    document.getElementById('form-error').style.display = 'block';
  }
});

document.getElementById('copy-btn').addEventListener('click', () => {
  const s = document.getElementById('result-subject').textContent;
  const e = document.getElementById('result-email').textContent;
  navigator.clipboard.writeText(`Subject: ${s}\n\n${e}`);
  const btn = document.getElementById('copy-btn');
  btn.textContent = '✓ COPIED'; btn.classList.add('copied');
  setTimeout(() => { btn.textContent = 'COPY'; btn.classList.remove('copied'); }, 2000);
});

document.getElementById('back-btn').addEventListener('click', () => show('form'));
init();
