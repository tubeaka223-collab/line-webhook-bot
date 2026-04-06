const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== キャッシュ =====
let cached = null;
let lastFetch = 0;

// ===== Alpha =====
async function getAlpha() {
  try {
    const res = await axios.get(
      `https://www.alphavantage.co/query?function=FX_INTRADAY&from_symbol=USD&to_symbol=JPY&interval=5min&apikey=${process.env.ALPHA_API_KEY}`
    );

    const data = res.data["Time Series FX (5min)"];
    if (!data) return null;

    return parseData(data);

  } catch {
    return null;
  }
}

// ===== Twelve Data =====
async function getTwelve() {
  try {
    const res = await axios.get(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=5min&apikey=${process.env.TWELVE_API_KEY}`
    );

    if (!res.data.values) return null;

    const data = {};
    res.data.values.forEach(v => {
      data[v.datetime] = { "4. close": v.close };
    });

    return parseData(data);

  } catch {
    return null;
  }
}

// ===== 共通解析 =====
function parseData(data) {
  const times = Object.keys(data).slice(0, 50);
  const prices = times.map(t => parseFloat(data[t]["4. close"]));

  const current = prices[0];
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const avg = prices.reduce((a,b)=>a+b,0)/prices.length;

  let trend = "レンジ";
  if (current > avg + 0.05) trend = "上昇";
  else if (current < avg - 0.05) trend = "下降";

  const range = high - low;
  if (range < 0.15) trend = "レンジ";

  return { current, high, low, trend, range, avg, isValid: true };
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

  } catch {
    return null;
  }
}

// ===== メイン =====
async function getFX() {
  const now = Date.now();

  if (cached && now - lastFetch < 60000) return cached;

  let fx = await getAlpha();

  if (!fx) {
    console.log("Alpha失敗 → Twelve");
    fx = await getTwelve();
  }

  if (!fx) {
    console.log("Twelve失敗 → fallback");
    fx = await getFallback();
  }

  if (!fx && cached) return cached;

  if (fx) {
    cached = fx;
    lastFetch = now;
  }

  return fx;
}

// ===== 売買 =====
function decideTrade(fx) {
  const { current, high, low, trend, range, isValid } = fx;

  let direction = "様子見";
  let entry = null;
  let tp = null;
  let sl = null;
  let mode = isValid ? "通常" : "簡易";

  if (!isValid) {
    return { direction, entry, tp, sl, mode };
  }

  if (current > high || current < low) {
    return { direction, entry, tp, sl, mode };
  }

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

// ===== 理由 =====
function generateReason(fx, trade) {
  if (!fx.isValid) {
    return "データ取得制限中のため簡易モード。精度低下中のため様子見推奨。";
  }

  const { current, avg, trend } = fx;

  if (trade.direction === "様子見") {
    return "明確なエントリーポイントなし。優位性が低いため見送り。";
  }

  if (trend === "上昇") {
    return `価格が平均(${avg.toFixed(2)})より上で上昇トレンド。押し目ロング。`;
  }

  if (trend === "下降") {
    return `価格が平均(${avg.toFixed(2)})より下で下降トレンド。戻り売り。`;
  }

  return "レンジ相場のため反発狙い。";
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message") {

      const replyToken = event.replyToken;
      const fx = await getFX();

      const trade = decideTrade(fx);

      const message = `
【ポジション】
${trade.direction}

【モード】
${trade.mode}

【トレンド】
${fx.isValid ? fx.trend : "-"}

【現在】
${fx.current.toFixed(2)}

【エントリー】
${trade.entry ? trade.entry.toFixed(2) : "-"}

【利確】
${trade.tp ? trade.tp.toFixed(2) : "-"}

【損切り】
${trade.sl ? trade.sl.toFixed(2) : "-"}

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