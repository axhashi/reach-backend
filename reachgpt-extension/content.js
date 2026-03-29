// ReachGPT Content Script — with retry for dynamic LinkedIn DOM

function scrapeProfile() {
  const data = {};

  // ── NAME ──────────────────────────────────────────────────────
  // LinkedIn renders name in different places depending on layout
  const nameSelectors = [
    'h1.text-heading-xlarge',
    'h1.inline',
    '.pv-text-details__left-panel h1',
    '.ph5 h1',
    '.profile-top-card h1',
    'section.artdeco-card h1',
    'h1',
  ];
  for (const sel of nameSelectors) {
    const el = document.querySelector(sel);
    const text = el?.innerText?.trim();
    if (text && text.length > 1 && text.length < 80) {
      data.name = text;
      break;
    }
  }

  // Last resort — extract from page title "Name | LinkedIn"
  if (!data.name) {
    const titleMatch = document.title.match(/^([^|]+)\s*\|/);
    if (titleMatch) data.name = titleMatch[1].trim();
  }

  // ── HEADLINE ──────────────────────────────────────────────────
  const headlineSelectors = [
    '.text-body-medium.break-words',
    '.pv-text-details__left-panel .text-body-medium',
    '.ph5 .text-body-medium',
    '.profile-top-card__headline',
  ];
  for (const sel of headlineSelectors) {
    const el = document.querySelector(sel);
    const text = el?.innerText?.trim();
    if (text && text !== data.name) { data.headline = text; break; }
  }

  // ── LOCATION ──────────────────────────────────────────────────
  const locSelectors = [
    '.text-body-small.inline.t-black--light.break-words',
    '.pv-text-details__left-panel .text-body-small.inline',
    '.ph5 .text-body-small.inline',
  ];
  for (const sel of locSelectors) {
    const el = document.querySelector(sel);
    const text = el?.innerText?.trim();
    if (text) { data.location = text; break; }
  }

  // ── ABOUT ─────────────────────────────────────────────────────
  const aboutSelectors = [
    '#about ~ div .full-width span[aria-hidden="true"]',
    '#about ~ div span[aria-hidden="true"]',
    '.pv-about-section .pv-about__summary-text',
  ];
  for (const sel of aboutSelectors) {
    const el = document.querySelector(sel);
    if (el?.innerText?.trim()) { data.about = el.innerText.trim().slice(0, 300); break; }
  }

  // ── EXPERIENCE ────────────────────────────────────────────────
  const experiences = [];
  const expSection = document.querySelector('#experience');
  if (expSection) {
    const items = expSection.parentElement?.querySelectorAll('li') || [];
    items.forEach((el, i) => {
      if (i > 2) return;
      const spans = el.querySelectorAll('span[aria-hidden="true"]');
      if (spans.length >= 2) {
        experiences.push(`${spans[0].innerText.trim()} at ${spans[1].innerText.trim()}`);
      }
    });
  }
  // Fallback — generic entity selectors
  if (experiences.length === 0) {
    document.querySelectorAll('[data-view-name="profile-component-entity"]').forEach((el, i) => {
      if (i > 2) return;
      const spans = el.querySelectorAll('span[aria-hidden="true"]');
      if (spans.length >= 2) experiences.push(`${spans[0].innerText.trim()} at ${spans[1].innerText.trim()}`);
    });
  }
  data.experiences = experiences;

  // ── POSTS ─────────────────────────────────────────────────────
  const posts = [];
  const postSelectors = [
    '.feed-shared-update-v2__description span[dir="ltr"]',
    '.update-components-text span[dir="ltr"]',
    '.feed-shared-text span[dir="ltr"]',
  ];
  for (const sel of postSelectors) {
    document.querySelectorAll(sel).forEach((el, i) => {
      if (i > 2) return;
      const text = el.innerText.trim();
      if (text.length > 30) posts.push(text.slice(0, 200));
    });
    if (posts.length > 0) break;
  }
  data.posts = posts;

  data.profileUrl = window.location.href;
  return data;
}

// Retry up to 5 times with 600ms gap — waits for LinkedIn's JS to render
function scrapeWithRetry(retries = 5) {
  return new Promise((resolve) => {
    let attempts = 0;
    function attempt() {
      const result = scrapeProfile();
      attempts++;
      if (result.name || attempts >= retries) {
        resolve(result);
      } else {
        setTimeout(attempt, 600);
      }
    }
    attempt();
  });
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'scrapeProfile') {
    scrapeWithRetry().then(sendResponse);
    return true; // keep channel open for async
  }
});
