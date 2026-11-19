import puppeteer from 'puppeteer-core';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.env.TEST_URL || 'http://127.0.0.1:8765/';
const OUT = 'D:/жизнь/ВУЗ/экзамены/audio-cards/tools/_shots/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--no-first-run', '--no-default-browser-check', '--autoplay-policy=no-user-gesture-required', '--disable-gpu', '--mute-audio'],
});
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(m.type() + ': ' + m.text()));
page.on('pageerror', (e) => logs.push('PAGEERROR: ' + e.message));

const result = {};
try {
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.card-row', { timeout: 30000 });
  await sleep(600);
  result.rows = await page.$$eval('.card-row', (els) => els.length);
  result.hintVisible = await page.$eval('#install-hint', (el) => !el.classList.contains('hidden'));
  await page.screenshot({ path: OUT + 'list.png' });

  await page.waitForFunction(() => /Готово/.test(document.getElementById('prep-status').textContent), { timeout: 90000 });
  result.prep = await page.$eval('#prep-status', (el) => el.textContent);

  const rows = await page.$$('.card-row');
  await rows[0].click();
  await rows[1].click();
  await sleep(400);
  result.selectedAfterToggle = await page.$eval('#sel-count', (el) => el.textContent);
  await page.waitForFunction(() => {
    try { return /Готово/.test(document.getElementById('prep-status').textContent) && !!state.prepared && state.prepared.key === selectionKey(); } catch (e) { return false; }
  }, { timeout: 90000 });

  await page.click('#btn-start');
  await page.waitForFunction(() => !document.getElementById('player').classList.contains('hidden'), { timeout: 30000 });
  await sleep(2200);
  result.audio = await page.evaluate(() => {
    const a = document.getElementById('audio');
    return { paused: a.paused, t: +a.currentTime.toFixed(2), dur: +((a.duration || 0).toFixed(2)), rate: a.playbackRate, err: a.error ? a.error.code : null };
  });
  result.pCount = await page.$eval('#p-count', (el) => el.textContent);
  result.part = await page.$eval('#p-part', (el) => el.textContent);
  result.timeline = await page.evaluate(() => ({
    duration: +state.session.duration.toFixed(2),
    cards: state.session.cards.length,
    perCard: state.session.timeline.perCard.map((p) => +p.start.toFixed(2)),
    segs: state.session.timeline.segs.length,
  }));
  result.decode = await page.evaluate(async () => {
    const a = document.getElementById('audio');
    const res = await fetch(a.src);
    const buf = await res.arrayBuffer();
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(buf);
    return { decoded: +decoded.duration.toFixed(2), mediaDuration: +((a.duration || 0).toFixed(2)), bytes: buf.byteLength };
  });
  result.mediaMeta = await page.evaluate(() => {
    try { return navigator.mediaSession.metadata ? { title: navigator.mediaSession.metadata.title, artist: navigator.mediaSession.metadata.artist } : null; } catch (e) { return null; }
  });
  await page.screenshot({ path: OUT + 'player.png' });

  // alignment check: jump to start of 3rd card
  const align = await page.evaluate(async () => {
    const starts = state.session.timeline.perCard.map((p) => p.start);
    const a = document.getElementById('audio');
    a.currentTime = starts[2] + 0.4;
    await new Promise((r) => setTimeout(r, 700));
    return { count: document.getElementById('p-count').textContent, num: document.getElementById('p-num').textContent };
  });
  result.alignment = align;

  // speed
  const speedBtns = await page.$$('#p-speed button');
  await speedBtns[0].click();
  await sleep(300);
  result.rateAfterSpeedClick = await page.evaluate(() => document.getElementById('audio').playbackRate);

  // pause / play
  await page.click('#p-play');
  await sleep(300);
  result.pausedAfterTap = await page.evaluate(() => document.getElementById('audio').paused);
  await page.click('#p-play');
  await sleep(300);
  result.playingAfterTap = await page.evaluate(() => !document.getElementById('audio').paused);

  // settings screenshot
  await page.click('#p-settings');
  await sleep(400);
  await page.screenshot({ path: OUT + 'settings.png' });
  result.settingsVisible = await page.evaluate(() => !document.getElementById('settings').classList.contains('hidden'));
  await page.click('#s-close');

  // offline playback
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.card-row', { timeout: 30000 });
  await sleep(1500);
  await page.setOfflineMode(true);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
  await sleep(1500);
  result.offlineRows = await page.$$eval('.card-row', (els) => els.length).catch(() => -1);
  await page.waitForFunction(() => /Готово/.test(document.getElementById('prep-status').textContent), { timeout: 90000 }).catch(() => {});
  result.offlinePrep = await page.$eval('#prep-status', (el) => el.textContent).catch(() => 'n/a');
  await page.click('#btn-start').catch(() => {});
  await sleep(2500);
  result.offlineAudio = await page.evaluate(() => {
    const a = document.getElementById('audio');
    return { paused: a.paused, t: +a.currentTime.toFixed(2), src: a.src.slice(0, 20) };
  }).catch((e) => String(e));
} catch (e) {
  result.fatal = String((e && e.stack) || e);
}

result.logs = logs.slice(0, 40);
console.log(JSON.stringify(result, null, 1));
await browser.close();
