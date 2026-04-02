const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== キャッシュ =====
let cache = null;
let lastFetch = 0;

// ===== 為替取得（Alpha + fallback）=====
async function getFX() {
  const now = Date.now();

  // 60秒キャッシュ
  if (cache && now - lastFetch < 60000) return cache;

  try {
    const res = await axios.get(
      `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=${process.env.ALPHA_API_KEY}`
    );

    const data = res.data["Time Series FX (5min)"];

    // ❌ API制限 or エラー
    if (!data) {
      console.log("Alpha死んだ → fallback");

      // ===== fallback（無料・無制限）=====
      const fallback = await axios.get(
        "https://api.exchangerate.host/convert?from=USD&to=JPY"
      );

      const price = fallback.data.result;

      if (!price) return null;

      const result = {
        current: price,
        high: price,
        low: price,
        trend: "レンジ"
      };

      cache = result;
      lastFetch = now;

      return result;
    }

    const times = Object.keys(data).slice(0, 20);

    if (times.length < 10) {
      console.log("データ不足");
      return null;
    }

    const prices = times.map(t => parseFloat(data[t]["4. close"]));

    const current = prices[0];
    const high = Math.max(...prices);
    const low = Math.min(...prices);

    // ===== トレンド判定（5分足）=====
    let trend = "レンジ";
    if (current > prices[5]) trend = "上昇";
    if (current < prices[5]) trend = "下降";

    const result = { current, high, low, trend };

    cache = result;
    lastFetch = now;

    return result;

  } catch (e) {
    console.log("完全エラー:", e.message);
    return null;
  }
}

// ===== ロジックエントリー =====
function createSignal(fx) {
  const { current, high, low, trend } = fx;

  let entry, tp, sl, side;

  if (trend === "上昇") {
    side = "ロング";
    entry = current;
    tp = current + 0.4;
    sl = current - 0.2;
  } else if (trend === "下降") {
    side = "ショート";
    entry = current;
    tp = current - 0.4;
    sl = current + 0.2;
  } else {
    // レンジはブレイク狙い
    side = "ロング";
    entry = high;
    tp = high + 0.3;
    sl = high - 0.2;
  }

  return {
    side,
    entry,
    tp,
    sl,
    trend
  };
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type !== "message") continue;

    const replyToken = event.replyToken;

    const fx = await getFX();

    if (!fx) {
      await axios.post("https://api.line.me/v2/bot/message/reply", {
        replyToken,
        messages: [{ type: "text", text: "為替取得エラー" }]
      }, {
        headers: {
          Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
          "Content-Type": "application/json"
        }
      });
      continue;
    }

    const signal = createSignal(fx);

    const text = `
【結論】
${signal.side}

【トレンド（5分足）】
${signal.trend}

【現在の状況】
現在価格：${fx.current.toFixed(2)}
高値：${fx.high.toFixed(2)}
安値：${fx.low.toFixed(2)}

【エントリー】
${signal.entry.toFixed(2)}

【利確】
${signal.tp.toFixed(2)}（+40pips）

【損切り】
${signal.sl.toFixed(2)}（-20pips）

【目線】
短期

【根拠】
5分足の直近データに基づくトレンドフォロー
`;

    await axios.post("https://api.line.me/v2/bot/message/reply", {
      replyToken,
      messages: [{ type: "text", text }]
    }, {
      headers: {
        Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () =>
  console.log("サーバー起動")
);