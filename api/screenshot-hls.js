const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch({ executablePath: '/usr/bin/chromium-browser', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1080 });
  await page.goto('http://rtmp-server-cc:8080', { waitUntil: 'networkidle2' });
  await page.evaluate(() => { window.scrollBy(0, 500); });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: '/app/hls-player-screencap.png' });
  await browser.close();
})();
