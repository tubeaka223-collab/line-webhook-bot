const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const { Configuration, OpenAIApi } = require("openai");

const app = express();
app.use(bodyParser.json());

// OpenAI初期化
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY, // 環境変数にOpenAI APIキーを設定
});
const openai = new OpenAIApi(configuration);

app.post("/webhook", async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === "message" && event.message.type === "text") {
            const replyToken = event.replyToken;
            const userMessage = event.message.text;

            try {
                // AIに解析して返信を作る
                const aiResponse = await openai.createChatCompletion({
                    model: "gpt-3.5-turbo",
                    messages: [
                        { role: "system", content: "あなたはFXのアドバイザーです。簡単で分かりやすく回答してください。" },
                        { role: "user", content: userMessage }
                    ],
                    max_tokens: 100
                });

                const replyMessage = aiResponse.data.choices[0].message.content;

                // LINEに返信
                await axios.post(
                    "https://api.line.me/v2/bot/message/reply",
                    {
                        replyToken: replyToken,
                        messages: [{ type: "text", text: replyMessage }],
                    },
                    { headers: { Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}` } }
                );

            } catch (error) {
                console.error("AI返信エラー:", error);

                // エラー時は簡易返信
                await axios.post(
                    "https://api.line.me/v2/bot/message/reply",
                    {
                        replyToken: replyToken,
                        messages: [{ type: "text", text: "すみません、現在対応できません。" }],
                    },
                    { headers: { Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}` } }
                );
            }
        }
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));