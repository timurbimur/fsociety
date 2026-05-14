const { app, BrowserWindow, ipcMain, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const crypto = require('crypto');
require('dotenv').config();

let mainWindow;
let schedulerInterval = null;

function reloadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const k = line.substring(0, eq).trim();
      const v = line.substring(eq + 1).trim();
      if (k && v) process.env[k] = v;
    }
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500, height: 900, minWidth: 1200, minHeight: 700,
    webPreferences: { nodeIntegration: true, contextIsolation: false },
    frame: false, backgroundColor: '#000000', show: false,
  });
  mainWindow.loadFile('src/index.html');
  mainWindow.once('ready-to-show', () => mainWindow.show());
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });

// ── Keys ────────────────────────────────────────────────────────────
ipcMain.handle('save-keys', async (_, keys) => {
  reloadEnv();
  const envPath = path.join(__dirname, '.env');
  const existing = {};
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const eq = line.indexOf('=');
      if (eq > 0) existing[line.substring(0, eq).trim()] = line.substring(eq + 1).trim();
    });
  }
  const merged = { ...existing, ...keys };
  fs.writeFileSync(envPath, Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('\n'));
  Object.assign(process.env, merged);
  return { success: true };
});

ipcMain.handle('get-keys', async () => {
  reloadEnv();
  return {
    COINBASE_API_KEY: process.env.COINBASE_API_KEY || '',
    COINBASE_API_SECRET: process.env.COINBASE_API_SECRET || '',
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || '',
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',
    TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',
  };
});

// ── Coinbase signed request helper ──────────────────────────────────
function cbSign(secret, timestamp, method, path, body = '') {
  return crypto.createHmac('sha256', secret).update(timestamp + method + path + body).digest('hex');
}

// ── Portfolio ───────────────────────────────────────────────────────
ipcMain.handle('fetch-portfolio', async () => {
  try {
    reloadEnv();
    const key = process.env.COINBASE_API_KEY;
    const secret = process.env.COINBASE_API_SECRET;
    if (!key || !secret) return { error: 'No Coinbase keys configured' };
    const ts = Math.floor(Date.now() / 1000).toString();
    const rp = '/api/v3/brokerage/accounts';
    const res = await fetch('https://api.coinbase.com' + rp, {
      headers: { 'CB-ACCESS-KEY': key, 'CB-ACCESS-SIGN': cbSign(secret, ts, 'GET', rp), 'CB-ACCESS-TIMESTAMP': ts, 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (data.error) return { error: data.error + ': ' + (data.message || '') };
    return data;
  } catch (e) { return { error: e.message }; }
});

// ── Place order (fixed) ─────────────────────────────────────────────
ipcMain.handle('place-order', async (_, { productId, side, amount }) => {
  try {
    reloadEnv();
    const key = process.env.COINBASE_API_KEY;
    const secret = process.env.COINBASE_API_SECRET;
    if (!key || !secret) return { error: 'No Coinbase API keys set' };
    const ts = Math.floor(Date.now() / 1000).toString();
    const rp = '/api/v3/brokerage/orders';
    const body = JSON.stringify({
      client_order_id: `fsociety-${Date.now()}`,
      product_id: productId,
      side: side.toUpperCase(),
      order_configuration: { market_market_ioc: { quote_size: parseFloat(amount).toFixed(2) } }
    });
    const res = await fetch('https://api.coinbase.com' + rp, {
      method: 'POST',
      headers: { 'CB-ACCESS-KEY': key, 'CB-ACCESS-SIGN': cbSign(secret, ts, 'POST', rp, body), 'CB-ACCESS-TIMESTAMP': ts, 'Content-Type': 'application/json' },
      body
    });
    const data = await res.json();
    console.log('Order response:', JSON.stringify(data));
    if (data.error_response) return { error: data.error_response.message || data.error_response.error };
    if (data.success === false) return { error: data.error_response?.message || 'Order failed' };
    return { success: true, order: data.success_response };
  } catch (e) { return { error: e.message }; }
});

// ── Prices (CoinGecko free) ─────────────────────────────────────────
ipcMain.handle('fetch-prices', async (_, coins) => {
  try {
    const ids = (coins || ['bitcoin','ethereum','solana','cardano','dogecoin','chainlink']).join(',');
    const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true&include_market_cap=true&include_24hr_vol=true`);
    return await res.json();
  } catch (e) { return { error: e.message }; }
});

// ── Price history for chart ─────────────────────────────────────────
ipcMain.handle('fetch-history', async (_, { coinId, days }) => {
  try {
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days || 7}&interval=daily`);
    const data = await res.json();
    return data.prices || [];
  } catch (e) { return []; }
});

// ── Real technical indicators from OHLC ─────────────────────────────
function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gains += d; else losses -= d;
  }
  let ag = gains / period, al = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return parseFloat((100 - 100 / (1 + ag / al)).toFixed(2));
}

function calcEMA(closes, period) {
  if (closes.length < period) return null;
  const k = 2 / (period + 1);
  let ema = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  return parseFloat(ema.toFixed(2));
}

function calcMACD(closes) {
  if (closes.length < 27) return null;
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  if (!ema12 || !ema26) return null;
  const macd = parseFloat((ema12 - ema26).toFixed(2));
  // build macd series for signal line
  const macdSeries = [];
  for (let i = 26; i <= closes.length; i++) {
    const e12 = calcEMA(closes.slice(0, i), 12);
    const e26 = calcEMA(closes.slice(0, i), 26);
    if (e12 && e26) macdSeries.push(e12 - e26);
  }
  const signal = macdSeries.length >= 9 ? parseFloat(calcEMA(macdSeries, 9).toFixed(2)) : null;
  const histogram = signal !== null ? parseFloat((macd - signal).toFixed(2)) : null;
  return { macd, signal, histogram, bullish: histogram !== null ? histogram > 0 : macd > 0 };
}

function calcBB(closes, period = 20) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / period);
  const last = closes[closes.length - 1];
  return {
    upper: parseFloat((mean + 2 * std).toFixed(2)),
    middle: parseFloat(mean.toFixed(2)),
    lower: parseFloat((mean - 2 * std).toFixed(2)),
    pct: parseFloat(((last - (mean - 2 * std)) / (4 * std) * 100).toFixed(1))
  };
}

ipcMain.handle('fetch-indicators', async (_, coinId) => {
  try {
    const id = coinId || 'bitcoin';
    const res = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/ohlc?vs_currency=usd&days=90`);
    const ohlc = await res.json();
    if (!Array.isArray(ohlc) || ohlc.length < 30) return { error: 'Not enough candle data' };
    const closes = ohlc.map(c => c[4]);
    const highs  = ohlc.map(c => c[2]);
    const lows   = ohlc.map(c => c[3]);
    const last   = closes[closes.length - 1];
    const rsi    = calcRSI(closes, 14);
    const macd   = calcMACD(closes);
    const bb     = calcBB(closes, 20);
    const ema20  = calcEMA(closes, 20);
    const ema50  = calcEMA(closes, 50);
    // ATR
    let atrSum = 0;
    for (let i = closes.length - 14; i < closes.length; i++) {
      const tr = Math.max(highs[i] - lows[i], Math.abs(highs[i] - (closes[i-1]||closes[i])), Math.abs(lows[i] - (closes[i-1]||closes[i])));
      atrSum += tr;
    }
    const atr    = parseFloat((atrSum / 14).toFixed(2));
    const atrPct = parseFloat(((atr / last) * 100).toFixed(2));
    const trend  = ema20 && ema50 ? (ema20 > ema50 ? 'UPTREND' : 'DOWNTREND') : 'UNKNOWN';
    const trendStrength = ema20 && ema50 ? Math.abs(((ema20 - ema50) / ema50) * 100).toFixed(2) : null;
    return { rsi, macd, bb, ema20, ema50, atr, atrPct, trend, trendStrength, last, coin: id };
  } catch (e) { return { error: e.message }; }
});

// ── News ────────────────────────────────────────────────────────────
ipcMain.handle('fetch-news', async () => {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/news');
    const data = await res.json();
    if (data.data) return data.data.slice(0, 20).map(n => ({ headline: n.title, source: n.author?.name || 'CoinGecko', url: n.url, datetime: new Date(n.updated_at).getTime() / 1000 }));
    throw new Error('no data');
  } catch {
    try {
      const r2 = await fetch('https://cryptopanic.com/api/free/v1/posts/?auth_token=free&kind=news');
      const d2 = await r2.json();
      return (d2.results || []).slice(0, 20).map(n => ({ headline: n.title, source: n.source?.title || 'CryptoPanic', url: n.url, datetime: new Date(n.published_at).getTime() / 1000 }));
    } catch { return []; }
  }
});

// ── Fear & Greed ────────────────────────────────────────────────────
ipcMain.handle('fetch-fear-greed', async () => {
  try {
    const res = await fetch('https://api.alternative.me/fng/');
    const d = await res.json();
    return { value: d.data?.[0]?.value, label: d.data?.[0]?.value_classification };
  } catch { return { value: null, label: 'Unknown' }; }
});

// ── AI Analysis ─────────────────────────────────────────────────────
ipcMain.handle('ai-analyze', async (_, { portfolio, prices, news, indicators, fearGreed }) => {
  try {
    reloadEnv();
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) return { error: 'No Anthropic API key set' };
    const prompt = `You are an elite algorithmic crypto trader. Analyze all real market data and return precise trade recommendations.

PORTFOLIO: ${JSON.stringify(portfolio)}
LIVE PRICES: ${JSON.stringify(prices)}
REAL TECHNICAL INDICATORS (from 90-day OHLC): ${JSON.stringify(indicators)}
FEAR & GREED INDEX: ${JSON.stringify(fearGreed)}
LATEST NEWS HEADLINES: ${JSON.stringify((news||[]).slice(0,8).map(n=>n.headline))}

Rules:
- Base confidence ONLY on real indicator signals (RSI overbought >70, oversold <30; MACD crossover; BB squeeze; trend alignment)
- Stop loss = current price ± 1.5x ATR
- Take profit = 2:1 risk/reward minimum
- Never suggest >20% portfolio in one trade

Respond ONLY in this exact JSON (no markdown, no extra text):
{"marketSentiment":"Bullish","sentimentScore":72,"summary":"1-2 sentence overview using real data","trades":[{"asset":"BTC","action":"BUY","confidence":85,"suggestedAmount":"$200","reasoning":"cite specific indicator values","newsDriver":"specific news catalyst","stopLoss":"$75000","takeProfit":"$90000"}],"riskWarning":"specific risk"}`;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-4-5', max_tokens: 1200, messages: [{ role: 'user', content: prompt }] })
    });
    const data = await res.json();
    if (data.error) return { error: 'Claude: ' + data.error.message };
    const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
    try { return JSON.parse(text); } catch { return { error: 'Parse error: ' + text.substring(0, 120) }; }
  } catch (e) { return { error: e.message }; }
});

// ── Telegram ────────────────────────────────────────────────────────
ipcMain.handle('send-telegram', async (_, msg) => {
  try {
    reloadEnv();
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;
    if (!token || !chatId) return { skipped: true };
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'HTML' })
    });
    return { success: true };
  } catch { return { error: 'Telegram failed' }; }
});

// ── Scheduler ───────────────────────────────────────────────────────
ipcMain.handle('set-scheduler', async (_, { minutes, enabled }) => {
  if (schedulerInterval) { clearInterval(schedulerInterval); schedulerInterval = null; }
  if (enabled && minutes > 0) schedulerInterval = setInterval(() => { if (mainWindow) mainWindow.webContents.send('scheduler-tick'); }, minutes * 60 * 1000);
  return { success: true };
});

// ── Persistence ─────────────────────────────────────────────────────
ipcMain.handle('save-trades', async (_, t) => { fs.writeFileSync(path.join(__dirname, 'trades.json'), JSON.stringify(t, null, 2)); return { success: true }; });
ipcMain.handle('load-trades', async () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'trades.json'), 'utf8')); } catch { return []; } });
ipcMain.handle('save-alerts', async (_, a) => { fs.writeFileSync(path.join(__dirname, 'alerts.json'), JSON.stringify(a)); return { success: true }; });
ipcMain.handle('load-alerts', async () => { try { return JSON.parse(fs.readFileSync(path.join(__dirname, 'alerts.json'), 'utf8')); } catch { return []; } });

// ── Notifications & Window ──────────────────────────────────────────
ipcMain.handle('notify', async (_, { title, body }) => { try { new Notification({ title, body }).show(); } catch {} return { success: true }; });
ipcMain.on('minimize-window', () => mainWindow.minimize());
ipcMain.on('maximize-window', () => mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize());
ipcMain.on('close-window', () => mainWindow.close());
