const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== キャッシュ =====
let cached = null;
let lastFetch = 0;

// ===== 5分足取得 =====
async function getAlpha() {
  try {
    const res = await axios.get(
      `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=${process.env.ALPHA_API_KEY}`
    );

    const data = res.data["Time Series FX (5min)"];
    if (!data) return null;

    const times = Object.keys(data).slice(0, 50);
    const prices = times.map(t => parseFloat(data[t]["4. close"]));

    const current = prices[0];
    const high = Math.max(...prices);
    const low = Math.min(...prices);

    // ===== 平均 =====
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    // ===== トレンド判定 =====
    let trend = "レンジ";

    if (current > avg + 0.05) trend = "上昇";
    else if (current < avg - 0.05) trend = "下降";

    // ===== ボラ判定 =====
    const range = high - low;
    if (range < 0.15) trend = "レンジ";

    return { current, high, low, trend, range };

  } catch (e) {
    console.log("Alpha失敗");
    return null;
  }
}

// ===== fallback =====
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
      trend: "レンジ",
      range: 0
    };

  } catch (e) {
    return null;
  }
}

// ===== メイン取得 =====
async function getFX() {
  const now = Date.now();

  if (cached && now - lastFetch < 60000) return cached;

  let fx = await getAlpha();
  if (!fx) fx = await getFallback();

  if (!fx && cached) return cached;

  if (fx) {
    cached = fx;
    lastFetch = now;
  }

  return fx;
}

// ===== 売買ロジック =====
function decideTrade(fx) {
  const { current, high, low, trend, range } = fx;

  let direction = "様子見";
  let entry = current;
  let tp = null;
  let sl = null;

  // ===== トレンド相場 =====
  if (trend === "上昇") {
    direction = "ロング";
    tp = current + 0.4;
    sl = current - 0.2;
  }

  else if (trend === "下降") {
    direction = "ショート";
    tp = current - 0.4;
    sl = current + 0.2;
  }

  // ===== レンジ相場 =====
  else {
    // 上限付近 → ショート
    if (current >= high - 0.05) {
      direction = "ショート";
      tp = current - 0.3;
      sl = current + 0.2;
    }
    // 下限付近 → ロング
    else if (current <= low + 0.05) {
      direction = "ロング";
      tp = current + 0.3;
      sl = current - 0.2;
    }
    // 中央 → 見送り
    else {
      direction = "様子見";
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

【現在】
${fx.current.toFixed(2)}

【エントリー】
${trade.entry.toFixed(2)}

【利確】
${trade.tp ? trade.tp.toFixed(2) : "-"}

【損切り】
${trade.sl ? trade.sl.toFixed(2) : "-"}
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