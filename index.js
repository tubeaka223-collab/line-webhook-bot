const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== キャッシュ =====
let cached = null;
let lastFetch = 0;

// ===== 通貨判定 =====
function detectPair(text) {
  const pairs = {
    "ドル円": { base: "USD", quote: "JPY" },
  };

  return pairs["ドル円"];
}

// ===== 5分足取得（Alpha Vantage）=====
async function getFX() {
  const now = Date.now();

  if (cached && now - lastFetch < 60000) return cached;

  try {
    const res = await axios.get(
      `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=${process.env.ALPHA_API_KEY}`
    );

    const data = res.data["Time Series FX (5min)"];
    if (!data) {
      console.log("データなし", res.data);
      return null;
    }

    const times = Object.keys(data).slice(0, 20);
    const prices = times.map(t => parseFloat(data[t]["4. close"]));

    const current = prices[0];
    const prev = prices[5];

    const high = Math.max(...prices);
    const low = Math.min(...prices);

    let trend = "レンジ";
    if (current > prev) trend = "上昇";
    if (current < prev) trend = "下降";

    cached = { current, high, low, trend };
    lastFetch = now;

    return cached;

  } catch (e) {
    console.log("取得失敗", e.message);
    return null;
  }
}

// ===== エントリーロジック =====
function decideTrade(fx) {
  const { current, high, low, trend } = fx;

  let direction, entry, tp, sl;

  if (trend === "上昇") {
    direction = "ロング";
    entry = current;
    tp = current + 0.4;
    sl = current - 0.2;
  } else if (trend === "下降") {
    direction = "ショート";
    entry = current;
    tp = current - 0.4;
    sl = current + 0.2;
  } else {
    // レンジ → ブレイク狙い
    if (current > (high - 0.05)) {
      direction = "ロング";
      entry = current;
      tp = current + 0.3;
      sl = current - 0.2;
    } else {
      direction = "ショート";
      entry = current;
      tp = current - 0.3;
      sl = current + 0.2;
    }
  }

  return { direction, entry, tp, sl };
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message") {

      const replyToken = event.replyToken;

      const fx = await getFX();

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

      const trade = decideTrade(fx);

      const message = `
【結論】
${trade.direction}

【トレンド（5分足）】
${fx.trend}

【現在の状況】
現在:${fx.current.toFixed(2)} / 高値:${fx.high.toFixed(2)} / 安値:${fx.low.toFixed(2)}

【エントリー】
${trade.entry.toFixed(2)}

【利確】
${trade.tp.toFixed(2)}

【損切り】
${trade.sl.toFixed(2)}

【根拠】
5分足ベースでトレンド方向に順張り
`;

      await axios.post(
        "https://api.line.me/v2/bot/message/reply",
        {
          replyToken,
          messages: [{ type: "text", text: message }],
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

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000);