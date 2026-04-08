require("dotenv").config();

const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== キャッシュ =====
let cache = null;
let lastFetch = 0;
let isFetching = false;

const MIN_INTERVAL = 15000;

// ===== Alpha取得 =====
async function getData() {
  const now = Date.now();

  if (cache && now - lastFetch < MIN_INTERVAL) {
    return cache;
  }

  if (isFetching) return cache;

  isFetching = true;

  try {
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=${process.env.ALPHA_API_KEY}`;

    const res = await axios.get(url);

    const data = res.data["Time Series FX (5min)"];

    // ===== エラー時 =====
    if (!data) {
      console.log("Alphaエラー:", res.data);
      return cache;
    }

    const times = Object.keys(data).slice(0, 60);
    const prices = times.map(t => parseFloat(data[t]["4. close"]));

    cache = prices;
    lastFetch = now;

    return prices;

  } catch (e) {
    console.log("取得失敗:", e.message);
    return cache;
  } finally {
    isFetching = false;
  }
}

// ===== 時間足 =====
function buildTF(prices, size) {
  const chunk = prices.slice(0, size);
  const current = chunk[0];
  const avg = chunk.reduce((a,b)=>a+b,0)/chunk.length;

  let trend = "レンジ";
  if (current > avg) trend = "上昇";
  else if (current < avg) trend = "下降";

  return { current, avg, trend };
}

// ===== 判断 =====
function decide(prices) {
  const m5 = buildTF(prices, 5);
  const h1 = buildTF(prices, 12);
  const h4 = buildTF(prices, 48);

  let direction = "様子見";
  let entry = null;
  let tp = null;
  let sl = null;

  if (h4.trend === "上昇" && h1.trend === "上昇" && m5.trend === "下降") {
    direction = "ロング";
    entry = m5.current;
    tp = entry + 0.4;
    sl = entry - 0.2;
  }

  else if (h4.trend === "下降" && h1.trend === "下降" && m5.trend === "上昇") {
    direction = "ショート";
    entry = m5.current;
    tp = entry - 0.4;
    sl = entry + 0.2;
  }

  return { direction, entry, tp, sl, m5, h1, h4 };
}

// ===== PUSH送信（重要）=====
async function push(userId, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/push",
    {
      to: userId,
      messages: [{ type: "text", text }]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ===== reply（即レス用）=====
async function reply(token, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken: token,
      messages: [{ type: "text", text }]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message") {

      const userId = event.source.userId;

      // ① 即レス（絶対返す）
      await reply(event.replyToken, "分析中…数秒待ってください");

      // ② 非同期で分析
      setTimeout(async () => {

        const prices = await getData();

        if (!prices) {
          await push(userId, "現在データ取得に失敗しています。30秒後に再度お試しください。");
          return;
        }

        const trade = decide(prices);

        const msg = `
【ポジション】
${trade.direction}

【現在】
${trade.m5.current.toFixed(2)}

【エントリー】
${trade.entry ? trade.entry.toFixed(2) : "-"}

【利確】
${trade.tp ? trade.tp.toFixed(2) : "-"}

【損切り】
${trade.sl ? trade.sl.toFixed(2) : "-"}

【相場状況】
・5分足：${trade.m5.trend}
・1時間足：${trade.h1.trend}
・4時間足：${trade.h4.trend}

【理由】
上位足一致＋短期逆行の押し目/戻りのみ狙う
`;

        await push(userId, msg);

      }, 2000);
    }
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);