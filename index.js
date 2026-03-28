const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// あとでRenderに設定する
const LINE_ACCESS_TOKEN = process.env.LINE_ACCESS_TOKEN;

app.post("/webhook", async (req, res) => {
    const events = req.body.events;

    for (const event of events) {
        if (event.type === "message" && event.message.type === "text") {
            const userMessage = event.message.text;

            const replyMessage = {
                type: "text",
                text: `受け取った: ${userMessage}`
            };

            await axios.post(
                "https://api.line.me/v2/bot/message/reply",
                {
                    replyToken: event.replyToken,
                    messages: [replyMessage]
                },
                {
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${LINE_ACCESS_TOKEN}`
                    }
                }
            );
        }
    }

    res.sendStatus(200);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));