const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

app.get("/", (req, res) => {
  res.send("OK");
});

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// 為替取得
async function getUSDJPY() {
  try {
    const res = await axios.get(
      "https://api.exchangerate.host/latest?base=USD&symbols=JPY"
    );
    return res.data.rates.JPY;
  } catch (e) {
    return null;
  }
}

app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const replyToken = event.replyToken;
      const userMessage = event.message.text;

      try {
        const price = await getUSDJPY();

        // ←ここが最重要
        const fixedPrice = Number(price).toFixed(2);

        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
あなたはプロのFXトレーダーです。

現在のドル円価格は【${fixedPrice}円】です。
この価格を必ず基準にして分析してください。
絶対に別の価格（例：113円など）を使ってはいけません。

必ず以下の形式で答えてください：

【結論】
ロング / ショート / 様子見

【トレンド】
レンジ or 上昇トレンド or 下降トレンド

【エントリー目安】
${fixedPrice}円を基準に±何pipsかで記載

【利確目安】
pipsで記載

【損切り】
pipsで記載

【目線】
短期・中期・長期

【理由】
シンプルに

※投資判断はユーザーに委ねること
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