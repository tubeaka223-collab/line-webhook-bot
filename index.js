const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// 動作確認
app.get("/", (req, res) => {
  res.send("OK");
});

// OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 🔥 リアルタイム価格取得（無料API）
async function getUSDJPY() {
  try {
    const res = await axios.get(
      "https://api.exchangerate-api.com/v4/latest/USD"
    );
    const jpy = res.data.rates.JPY;
    return jpy;
  } catch (e) {
    console.error("価格取得エラー", e.message);
    return null;
  }
}

// Webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhookきた");

  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const replyToken = event.replyToken;
      const userMessage = event.message.text;

      const price = await getUSDJPY();

      if (!price) {
        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: replyToken,
            messages: [{ type: "text", text: "価格取得エラー" }],
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
content: `
あなたはプロのFXトレーダーです。

現在のドル円価格は【${price.toFixed(2)}円】です。

【絶対ルール】
・様子見は禁止（必ずロングかショート）
・数字は必ず現在価格ベースで計算
・適当な過去価格は禁止
・当日の流れは現実的に（上昇→転換→下落など）
・ファンダは必ず埋める（推測OK）
・全項目必須
・スワップに関する記述は禁止

【出力形式】

【結論】
ロング or ショート

【トレンド】
上昇 / 下降 / レンジ

【当日の流れ】
・東京時間：
・ロンドン時間：
・現在の動き：

【戦略】
・どこで入るか
・どこで損切りか

【エントリー】
価格

【利確】
pipsと価格

【損切り】
pipsと価格

【目線】
短期

【ファンダ】
日米金利差：
FRB：
日銀：
市場状況：

【根拠】
テクニカル＋市場心理


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
            replyToken: replyToken,
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
        console.error(error.response?.data || error.message);

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: replyToken,
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