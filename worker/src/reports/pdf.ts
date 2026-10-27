import { existsSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

// Chrome is not bundled: the worker uses the one on the machine (or in the container).
// CHROME_PATH wins; otherwise the usual install locations are tried.
const CANDIDATES = [
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

export function findChrome(): string | null {
  const configured = process.env.CHROME_PATH;
  if (configured) return existsSync(configured) ? configured : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

// The page is our own template, but it embeds client-supplied logos, so the browser runs
// with JavaScript off and every network request refused.
export async function renderPdf(html: string): Promise<Uint8Array> {
  const executablePath = findChrome();
  if (!executablePath) throw new Error('No Chrome found. Set CHROME_PATH to render reports.');

  const browser = await puppeteer.launch({
    executablePath,
    headless: true,
    // Containers usually run as root, where Chrome's sandbox cannot start.
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
  });
  try {
    const page = await browser.newPage();
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      if (req.url().startsWith('data:') || req.url() === 'about:blank') req.continue();
      else req.abort();
    });
    await page.setContent(html, { waitUntil: 'load' });
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
}
