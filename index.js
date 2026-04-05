const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== キャッシュ =====
let cached = null;
let lastFetch = 0;

// ===== データ取得 =====
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

    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;

    let trend = "レンジ";
    if (current > avg + 0.05) trend = "上昇";
    else if (current < avg - 0.05) trend = "下降";

    const range = high - low;
    if (range < 0.15) trend = "レンジ";

    return { current, high, low, trend, range, avg, isValid: true };

  } catch (e) {
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
      range: 0,
      avg: price,
      isValid: false
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
  const { current, high, low, trend, range, isValid } = fx;

  let direction = "様子見";
  let entry = null;
  let tp = null;
  let sl = null;
  let mode = "通常";

  // ===== 簡易モード =====
  if (!isValid) {
    mode = "簡易";

    // 超簡易判断（方向だけ出す）
    if (Math.random() > 0.5) {
      direction = "ややロング寄り（様子見）";
    } else {
      direction = "ややショート寄り（様子見）";
    }

    return { direction, entry, tp, sl, mode };
  }

  // ===== ブレイク回避 =====
  if (current > high || current < low) {
    return { direction, entry, tp, sl, mode };
  }

  // ===== トレンド =====
  if (trend === "上昇") {
    direction = "ロング";
    entry = current - 0.02;
    tp = current + 0.4;
    sl = current - 0.2;
  }

  else if (trend === "下降") {
    direction = "ショート";
    entry = current + 0.02;
    tp = current - 0.4;
    sl = current + 0.2;
  }

  // ===== レンジ =====
  else {
    if (range > 0.3) {

      if (current >= high - 0.05) {
        direction = "ショート";
        entry = current + 0.02;
        tp = current - (range * 0.5);
        sl = high + 0.05;
      }

      else if (current <= low + 0.05) {
        direction = "ロング";
        entry = current - 0.02;
        tp = current + (range * 0.5);
        sl = low - 0.05;
      }
    }
  }

  return { direction, entry, tp, sl, mode };
}

// ===== 理由生成 =====
function generateReason(fx, trade) {
  const { current, high, low, trend, range, avg, isValid } = fx;

  if (!isValid) {
    return "現在リアルタイムデータ取得制限中のため簡易分析。方向感は弱く、明確な優位性がないため基本は様子見推奨。";
  }

  const rangeInfo = `レンジ幅：約${range.toFixed(2)}円`;
  const avgInfo = `平均価格：約${avg.toFixed(2)}`;

  if (trade.direction === "様子見") {
    return `${rangeInfo}と小さく、トレンドも不明確なため見送り。`;
  }

  if (trend === "上昇") {
    return `現在価格${current.toFixed(2)}は${avgInfo}より上で上昇トレンド。押し目ロング。`;
  }

  if (trend === "下降") {
    return `現在価格${current.toFixed(2)}は${avgInfo}より下で下降トレンド。戻り売り。`;
  }

  if (trend === "レンジ") {
    const mid = (high + low) / 2;

    if (trade.direction.includes("ショート")) {
      return `レンジ上限（${high.toFixed(2)}）付近のためショート。利確は${mid.toFixed(2)}。`;
    }

    if (trade.direction.includes("ロング")) {
      return `レンジ下限（${low.toFixed(2)}）付近のためロング。利確は${mid.toFixed(2)}。`;
    }
  }

  return "相場状況から総合判断。";
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
【ポジション】
${trade.direction}

【モード】
${trade.mode}

【トレンド（5分足）】
${fx.isValid ? fx.trend : "-"}

【現在】
${fx.current.toFixed(2)}

【エントリー】
${trade.entry !== null ? trade.entry.toFixed(2) : "-"}

【利確】
${trade.tp !== null ? trade.tp.toFixed(2) : "-"}

【損切り】
${trade.sl !== null ? trade.sl.toFixed(2) : "-"}

【理由】
${generateReason(fx, trade)}
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