const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// あとでRenderに設定する
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

app.post("/webhook", async (req, res) => {
const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");           // LINE返信用
const { Configuration, OpenAIApi } = require("openai");  // ここ追加

// OpenAI初期化
const configuration = new Configuration({
    apiKey: process.env.OPENAI_API_KEY,
});
const openai = new OpenAIApi(configuration);

const app = express();
app.use(bodyParser.json());

app.post("/webhook", async (req, res) => {
    const events = req.body.events;
    if (!events) return res.sendStatus(200);

    for (let event of events) {
        if (event.type === "message" && event.message.type === "text") {
            const replyToken = event.replyToken;
            const userMessage = event.message.text;

            // ここでAIに送信して返信を作る
            // const aiResponse = await openai.createChatCompletion({...});
            // const replyMessage = aiResponse.data.choices[0].message.content;

            const replyMessage = `受け取った：${userMessage} 自動返信文です`; // とりあえずテスト

            await axios.post(
                "https://api.line.me/v2/bot/message/reply",
                {
                    replyToken: replyToken,
                    messages: [{ type: "text", text: replyMessage }],
                },
                { headers: { Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}` } }
            );
        }
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));