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

// ===== 5分足データ取得（Alpha Vantage）=====
async function getFXData() {
  try {
    const res = await axios.get(
      "https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=demo"
    );

    const data = res.data["Time Series FX (5min)"];
    if (!data) return null;

    const times = Object.keys(data).slice(0, 20); // 直近20本

    let prices = times.map((t) => parseFloat(data[t]["4. close"]));

    const current = prices[0];
    const high = Math.max(...prices);
    const low = Math.min(...prices);

    // ===== トレンド判定 =====
    let trend = "レンジ";
    if (current > prices[5]) trend = "上昇";
    if (current < prices[5]) trend = "下降";

    return {
      current,
      high,
      low,
      trend,
    };
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
・±50pips以内
・トレンドに従う（上昇→ロング、下降→ショート）
・データに無い情報は書かない（妄想禁止）
・スワップ禁止
・東京時間やロンドン時間など存在しない情報は禁止

【形式】
【結論】
ロング or ショート

【トレンド】
上昇 / 下降 / レンジ

【現在の状況】
現在価格・高値・安値をベースに説明

【戦略】
エントリーと損切りを具体的に

【エントリー】
価格

【利確】
pipsと価格

【損切り】
pipsと価格

【目線】
短期

【ファンダ】
※一般論ではなく、簡潔に1行だけ

【根拠】
テクニカルベースで説明

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log("サーバー稼働中"));