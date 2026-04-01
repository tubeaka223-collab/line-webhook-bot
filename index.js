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

// 為替レート取得（USDJPY）
async function getUSDJPY() {
  try {
    const res = await axios.get(
      "https://api.exchangerate.host/latest?base=USD&symbols=JPY"
    );
    return res.data.rates.JPY;
  } catch (e) {
    console.error("レート取得エラー", e.message);
    return null;
  }
}

// Webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhook受信");

  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const replyToken = event.replyToken;
      const userMessage = event.message.text;

      try {
        // リアルタイム価格取得
        const price = await getUSDJPY();

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
あなたはプロのFXトレーダーです。
初心者にも分かりやすく答えてください。

現在のドル円価格は ${price} 円です。

必ず以下の形式で回答してください：

【結論】
ロング / ショート / 様子見

【トレンド】
レンジ or 上昇トレンド or 下降トレンド

【エントリー目安】
現在価格から何pipsでエントリー

【利確目安】
何pipsで利確

【損切り】
何pipsで損切り

【目線】
短期・中期・長期

【理由】
シンプルに

※投資判断はユーザーに委ねてください。
※断定的な助言は禁止
              `,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          max_tokens: 1000,
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
        console.error("エラー:", error.response?.data || error.message);

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: replyToken,
            messages: [
              { type: "text", text: "エラーが発生しました" },
            ],
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