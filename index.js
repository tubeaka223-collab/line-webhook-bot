
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// ===== 動作確認 =====
app.get("/", (req, res) => {
  res.send("OK");
});

// ===== OpenAI =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== 通貨マップ =====
const PAIRS = {
  "ドル円": { from: "USD", to: "JPY" },
  "ユーロ円": { from: "EUR", to: "JPY" },
  "ポンド円": { from: "GBP", to: "JPY" },
  "豪ドル円": { from: "AUD", to: "JPY" },
  "ユーロドル": { from: "EUR", to: "USD" },
  "ポンドドル": { from: "GBP", to: "USD" },
};

// ===== キャッシュ =====
let cache = {};
let lastFetch = {};

// ===== 為替取得 =====
async function getFXData(pairKey) {
  const now = Date.now();

  if (cache[pairKey] && now - (lastFetch[pairKey] || 0) < 300000) {
    return cache[pairKey];
  }

  const pair = PAIRS[pairKey];

  try {
    const url = `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=${pair.from}&to_symbol=${pair.to}&interval=5min&apikey=${process.env.ALPHA_API_KEY}`;

    const res = await axios.get(url);

    if (res.data.Note || res.data.Information) {
      console.error("API制限:", res.data);
      return cache[pairKey];
    }

    const data = res.data["Time Series FX (5min)"];
    if (!data) {
      console.error("データなし:", res.data);
      return cache[pairKey];
    }

    const times = Object.keys(data).slice(0, 20);

    const prices = times.map((t) =>
      parseFloat(data[t]["4. close"])
    );

    const current = prices[0];
    const high = Math.max(...prices);
    const low = Math.min(...prices);

    let trend = "レンジ";
    if (current > prices[5]) trend = "上昇";
    if (current < prices[5]) trend = "下降";

    cache[pairKey] = { current, high, low, trend };
    lastFetch[pairKey] = now;

    console.log(`${pairKey}更新:`, cache[pairKey]);

    return cache[pairKey];
  } catch (e) {
    console.error("取得失敗:", e.message);
    return cache[pairKey];
  }
}

// ===== 通貨判定 =====
function detectPair(text) {
  for (let key in PAIRS) {
    if (text.includes(key)) return key;
  }
  return null;
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  console.log("Webhookきた");

  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const replyToken = event.replyToken;
      const userMessage = event.message.text;

      const pairKey = detectPair(userMessage);

      if (!pairKey) {
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken,
            messages: [
              {
                type: "text",
                text: "対応通貨：ドル円・ユーロ円・ポンド円・豪ドル円・ユーロドル・ポンドドル",
              },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        continue;
      }

      const fx = await getFXData(pairKey);

      if (!fx) {
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken,
            messages: [{ type: "text", text: "為替取得エラー" }],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
        continue;
      }

      try {
        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
あなたはプロのFXトレーダーです。

【通貨ペア】
${pairKey}

【リアルデータ】
現在価格：${fx.current.toFixed(3)}
高値：${fx.high.toFixed(3)}
安値：${fx.low.toFixed(3)}
トレンド：${fx.trend}

【ルール】
・ロング or ショートのみ（様子見禁止）
・トレンドに従う
・±50pips以内
・妄想禁止
・スワップ禁止

【形式】
【結論】
【トレンド】
【現在の状況】
【戦略】
【エントリー】
【利確】
【損切り】
【目線】
【ファンダ】
【根拠】
`,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          max_tokens: 800,
        });

        const replyMessage =
          aiResponse.choices[0].message.content || "エラー";

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken,
            messages: [{ type: "text", text: replyMessage }],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      } catch (error) {
        console.error("AIエラー:", error.message);

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken,
            messages: [{ type: "text", text: "AIエラー" }],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
              "Content-Type": "application/json",
            },
          }
        );
      }
    }
  }

  res.sendStatus(200);
});

// ===== 起動 =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("サーバー稼働中"));