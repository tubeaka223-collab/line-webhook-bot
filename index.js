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

// ===== キャッシュ =====
let cachedFX = null;
let lastFetch = 0;

// ===== 為替取得（5分足 + キャッシュ）=====
async function getFXData() {
  const now = Date.now();

  // 30秒キャッシュ
  if (cachedFX && now - lastFetch < 30000) {
    return cachedFX;
  }

  try {
    const res = await axios.get(
      `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=${process.env.ALPHA_API_KEY}`
    );

    const data = res.data["Time Series FX (5min)"];

    // API制限・エラー対策
    if (!data) {
      console.error("データなし:", res.data);
      return null;
    }

    const times = Object.keys(data).slice(0, 20);

    const prices = times.map((t) =>
      parseFloat(data[t]["4. close"])
    );

    const current = prices[0];
    const high = Math.max(...prices);
    const low = Math.min(...prices);

    // ===== トレンド判定 =====
    let trend = "レンジ";
    if (current > prices[5]) trend = "上昇";
    if (current < prices[5]) trend = "下降";

    cachedFX = { current, high, low, trend };
    lastFetch = now;

    return cachedFX;
  } catch (e) {
    console.error("為替取得失敗:", e.message);
    return null;
  }
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

      const fx = await getFXData();

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

【リアルデータ】
現在価格：${fx.current.toFixed(2)}円
直近高値：${fx.high.toFixed(2)}円
直近安値：${fx.low.toFixed(2)}円
トレンド：${fx.trend}

【ルール】
・必ずロング or ショート（様子見禁止）
・トレンドに従う（上昇→ロング、下降→ショート）
・±50pips以内で現実的に書く
・存在しない情報を書かない（妄想禁止）
・スワップ項目は禁止

【形式】
【結論】
ロング or ショート

【トレンド】
上昇 / 下降 / レンジ

【現在の状況】
（価格・高値・安値ベースで説明）

【戦略】
エントリーと損切り

【エントリー】
価格：

【利確】
pipsと価格：

【損切り】
pipsと価格：

【目線】
短期

【ファンダ】
1行で簡潔に

【根拠】
テクニカルベース
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