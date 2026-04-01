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

// 🔥 安定して取れるAPIに変更（超重要）
async function getUSDJPY() {
  try {
    const res = await axios.get(
      "https://api.exchangerate-api.com/v4/latest/USD"
    );
    return res.data.rates.JPY;
  } catch (e) {
    console.error("価格取得エラー:", e.message);
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

        // 🔥 fallback追加（ここ大事）
        if (!price) {
          await axios.post(
            "https://api.line.me/v2/bot/message/reply",
            {
              replyToken: replyToken,
              messages: [
                { type: "text", text: "価格取得エラー（API失敗）" },
              ],
            },
            {
              headers: {
                Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
              },
            }
          );
          continue;
        }

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
絶対に別の価格を使ってはいけません。

必ず以下の形式：

【結論】
ロング / ショート / 様子見

【トレンド】
レンジ or 上昇 or 下降

【エントリー】
${fixedPrice}円基準 ±pips

【利確】
pips

【損切り】
pips

【目線】
短期・中期・長期

【理由】
簡潔に
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
        console.error("全体エラー:", error.message);

        await axios.post(
          "https://api.line.me/v2/bot/message/reply",
          {
            replyToken: replyToken,
            messages: [
              { type: "text", text: "エラー発生" },
            ],
          },
          {
            headers: {
              Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
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