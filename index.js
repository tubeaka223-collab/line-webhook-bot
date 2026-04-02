const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== キャッシュ =====
let cached = null;
let lastFetch = 0;

// ===== 5分足（Alpha）=====
async function getAlpha() {
  try {
    const res = await axios.get(
      `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=${process.env.ALPHA_API_KEY}`
    );

    const data = res.data["Time Series FX (5min)"];

    if (!data) {
      console.log("Alpha制限 or エラー:", res.data);
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

    return { current, high, low, trend };

  } catch (e) {
    console.log("Alpha失敗");
    return null;
  }
}

// ===== 単発レート（保険）=====
async function getFallback() {
  try {
    const res = await axios.get(
      "https://api.frankfurter.app/latest?from=USD&to=JPY"
    );

    const price = res.data.rates.JPY;

    return {
      current: price,
      high: price,
      low: price,
      trend: "レンジ"
    };

  } catch (e) {
    console.log("Fallback失敗");
    return null;
  }
}

// ===== メイン取得 =====
async function getFX() {
  const now = Date.now();

  // 60秒キャッシュ
  if (cached && now - lastFetch < 60000) return cached;

  // ① Alpha
  let fx = await getAlpha();

  // ② fallback
  if (!fx) {
    fx = await getFallback();
  }

  // ③ キャッシュ
  if (!fx && cached) {
    console.log("キャッシュ使用");
    return cached;
  }

  if (fx) {
    cached = fx;
    lastFetch = now;
  }

  return fx;
}

// ===== ロジック =====
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
    if (current > high - 0.05) {
      direction = "ロング";
      tp = current + 0.3;
      sl = current - 0.2;
    } else {
      direction = "ショート";
      tp = current - 0.3;
      sl = current + 0.2;
    }
    entry = current;
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
            messages: [{ type: "text", text: "為替取得エラー（API制限）" }],
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

【現在】
${fx.current.toFixed(2)}

【エントリー】
${trade.entry.toFixed(2)}

【利確】
${trade.tp.toFixed(2)}

【損切り】
${trade.sl.toFixed(2)}
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