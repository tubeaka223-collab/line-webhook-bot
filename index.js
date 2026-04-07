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

const MIN_INTERVAL = 15000; // 15秒

// ===== Alpha Vantage取得 =====
async function getData() {
  const now = Date.now();

  // キャッシュ使用
  if (cache && now - lastFetch < MIN_INTERVAL) {
    console.log("キャッシュ使用");
    return cache;
  }

  // 同時実行防止
  if (isFetching) {
    console.log("取得中のためキャッシュ返却");
    return cache;
  }

  isFetching = true;

  try {
    const apiKey = process.env.ALPHA_API_KEY;

    if (!apiKey) {
      console.log("APIキー未設定");
      return cache;
    }

    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=${apiKey}`;

    const res = await axios.get(url);

    console.log("Alphaレスポンス:", res.data);

    const data = res.data["Time Series FX (5min)"];

    // ===== エラー判定 =====
    if (!data) {
      console.log("データ取得失敗（制限 or エラー）");
      return cache;
    }

    const times = Object.keys(data).slice(0, 60);
    const prices = times.map(t => parseFloat(data[t]["4. close"]));

    cache = prices;
    lastFetch = now;

    console.log("API取得成功");

    return prices;

  } catch (e) {
    console.log("取得失敗:", e.message);
    return cache;
  } finally {
    isFetching = false;
  }
}

// ===== 時間足生成 =====
function buildTF(prices, size) {
  const chunk = prices.slice(0, size);

  const current = chunk[0];
  const avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;

  let trend = "レンジ";
  if (current > avg) trend = "上昇";
  else if (current < avg) trend = "下降";

  return { current, avg, trend };
}

// ===== トレード判断 =====
function decide(prices) {
  const m5 = buildTF(prices, 5);
  const h1 = buildTF(prices, 12);
  const h4 = buildTF(prices, 48);

  let direction = "様子見";
  let entry = null;
  let tp = null;
  let sl = null;

  if (h4.trend === "上昇" && h1.trend === "上昇") {
    if (m5.trend === "下降") {
      direction = "ロング";
      entry = m5.current;
      tp = entry + 0.4;
      sl = entry - 0.2;
    }
  }

  else if (h4.trend === "下降" && h1.trend === "下降") {
    if (m5.trend === "上昇") {
      direction = "ショート";
      entry = m5.current;
      tp = entry - 0.4;
      sl = entry + 0.2;
    }
  }

  return { direction, entry, tp, sl, m5, h1, h4 };
}

// ===== LINE返信 =====
async function reply(token, text) {
  try {
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
  } catch (e) {
    console.log("返信失敗:", e.message);
  }
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  // ★まず即レス（Render対策）
  for (let event of events) {
    if (event.type === "message") {
      await reply(event.replyToken, "取得中…少し待ってください");
    }
  }

  const prices = await getData();

  for (let event of events) {
    if (event.type === "message") {

      // データ取得できない場合
      if (!prices) {
        await reply(
          event.replyToken,
          "現在データ取得が不安定です。\n少し間をおいてもう一度送信してください。"
        );
        continue;
      }

      const trade = decide(prices);

      const message = `
【ポジション】
${trade.direction}

【現在】
${trade.m5.current.toFixed(2)}

【エントリー目安】
${trade.entry ? trade.entry.toFixed(2) : "-"}

【利確目安】
${trade.tp ? trade.tp.toFixed(2) : "-"}

【損切り目安】
${trade.sl ? trade.sl.toFixed(2) : "-"}

【相場状況】
・短期：${trade.m5.trend}
・中期：${trade.h1.trend}
・長期：${trade.h4.trend}

【戦略】
上位足と方向一致＋短期の押し目/戻りのみ狙う
`;

      await reply(event.replyToken, message);
    }
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("サーバー起動");
});