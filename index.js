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

// Webhook
app.post("/webhook", async (req, res) => {
  console.log("Webhookきた");

  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const replyToken = event.replyToken;
      const userMessage = event.message.text;

      try {
        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
あなたはプロのFXトレーダーです。
初心者にも分かりやすく、具体的に答えてください。

▼必ず含める内容
・ロング or ショート or 様子見
・エントリーポイント（価格目安）
・利確ポイント
・損切りポイント
・短期 / 中期 / 長期の目線
・トレンド or レンジ判断
・根拠（簡単に）

※投資助言になりすぎないよう「参考レベル」として表現する
※最大1000文字以内
              `,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          max_tokens: 1000, // ←ここ重要（増やした）
        });

        const replyMessage =
          aiResponse.choices[0].message.content?.slice(0, 800) ||
          "うまく生成できませんでした";

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