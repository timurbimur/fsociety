# FSOCIETY — AI Crypto Trader

An AI-powered desktop app that monitors your crypto portfolio, analyzes news, and suggests (or automatically executes) trades using Claude AI.

---

## 🚀 Setup Instructions

### 1. Install Node.js
Download from https://nodejs.org (LTS version)

### 2. Extract this folder somewhere on your PC
Example: `C:\Users\YourName\cipher-ai-trader`

### 3. Open a terminal in the folder
- Right-click inside the folder → "Open in Terminal" (or PowerShell)

### 4. Install dependencies
```
npm install
```

### 5. Run the app
```
npm start
```

---

## 🔑 Adding Your API Keys

When the app opens, click ⚙ **Settings** in the sidebar and enter:

| Key | Where to get it |
|---|---|
| Coinbase API Key | coinbase.com → Settings → API |
| Coinbase API Secret | Same place |
| Anthropic API Key | console.anthropic.com → API Keys |
| Finnhub API Key | finnhub.io (free account, optional) |

Keys are stored locally in a `.env` file — never sent anywhere except the respective APIs.

---

## 🤖 How to Use

1. **Dashboard** — See live crypto prices updating every 30 seconds
2. **Run Analysis** — Click the purple button to have Claude AI analyze your portfolio + news
3. **Approve Trades** — Review AI recommendations and click ✓ EXECUTE or ✕ SKIP
4. **Autopilot** — Toggle in the sidebar to let AI execute trades automatically
5. **Risk Controls** — Set max trade size and daily loss limit in Settings

---

## ⚠️ Important

- Start with **small amounts** until you trust the AI's performance
- The AI's suggestions are **not financial advice**
- Crypto trading carries **significant risk**
- Always set a **daily loss limit** in Settings

---

## 📁 File Structure

```
cipher-ai-trader/
├── main.js          ← Electron backend (API calls, trade execution)
├── src/
│   └── index.html   ← The entire UI
├── assets/          ← Icons
├── .env             ← Your API keys (auto-created when you save keys)
└── package.json
```
