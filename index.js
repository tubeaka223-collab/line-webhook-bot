const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// ===== OpenAI =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== 通貨判定 =====
function detectPair(text) {
  const pairs = {
    "ドル円": { base: "USD", quote: "JPY" },
    "ユーロ円": { base: "EUR", quote: "JPY" },
    "ポンド円": { base: "GBP", quote: "JPY" },
    "ユーロドル": { base: "EUR", quote: "USD" },
    "ポンドドル": { base: "GBP", quote: "USD" },
  };

  for (let key in pairs) {
    if (text.includes(key)) return { name: key, ...pairs[key] };
  }

  return { name: "ドル円", base: "USD", quote: "JPY" };
}

// ===== 為替取得（超安定）=====
async function getRate(base, quote) {
  try {
    const res = await axios.get(
      `https://api.exchangerate.host/convert?from=${base}&to=${quote}`
    );

    return res.data.result;
  } catch (e) {
    console.error("取得失敗:", e.message);
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

      const pair = detectPair(userMessage);
      const price = await getRate(pair.base, pair.quote);

      if (!price) {
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

【通貨】
${pair.name}

【現在価格】
${price.toFixed(2)}

【ルール】
・必ずロング or ショート（様子見禁止）
・±50pips以内
・現実的な数値
・スワップ書かない
・妄想の時間軸（東京時間など）禁止

【形式】
【結論】
ロング or ショート

【トレンド】
上昇 / 下降 / レンジ

【現在の状況】
価格ベースで説明

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
1行

【根拠】
テクニカル
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

app.listen(process.env.PORT || 3000, () =>
  console.log("サーバー稼働中")
);