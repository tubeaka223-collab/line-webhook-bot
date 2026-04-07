const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== キャッシュ =====
let cache = null;
let lastFetch = 0;
let isFetching = false;

const MIN_INTERVAL = 15000; // 15秒

// ===== データ取得 =====
async function getData() {
  const now = Date.now();

  // キャッシュ使用
  if (cache && now - lastFetch < MIN_INTERVAL) {
    console.log("キャッシュ使用");
    return cache;
  }

  // 同時実行防止
  if (isFetching) {
    console.log("取得中のためキャッシュ返却");
    return cache;
  }

  isFetching = true;

  try {
    const apiKey = process.env.TWELVE_API_KEY;

    // ★ APIキー確認
    if (!apiKey) {
      console.log("APIキー未設定");
      return cache;
    }

    const url = `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=5min&outputsize=60&apikey=${apiKey}`;

    const res = await axios.get(url);

    console.log("APIレスポンス:", res.data);

    // ===== エラー判定（ここ重要）=====
    if (res.data.code) {
      console.log("APIエラー:", res.data.message);
      return cache;
    }

    if (!res.data.values) {
      console.log("データなし");
      return cache;
    }

    const prices = res.data.values.map(v => parseFloat(v.close));

    // キャッシュ更新
    cache = prices;
    lastFetch = now;

    console.log("API取得成功");

    return prices;

  } catch (e) {
    console.log("取得失敗:", e.message);
    return cache;
  } finally {
    isFetching = false;
  }
}

// ===== 時間足生成 =====
function buildTF(prices, size) {
  const chunk = prices.slice(0, size);

  const current = chunk[0];
  const avg = chunk.reduce((a, b) => a + b, 0) / chunk.length;

  let trend = "レンジ";
  if (current > avg) trend = "上昇";
  else if (current < avg) trend = "下降";

  return { current, avg, trend };
}

// ===== トレード判断 =====
function decide(prices) {
  const m5 = buildTF(prices, 5);
  const h1 = buildTF(prices, 12);
  const h4 = buildTF(prices, 48);

  let direction = "様子見";
  let entry = null;
  let tp = null;
  let sl = null;

  // 上位足一致のみ
  if (h4.trend === "上昇" && h1.trend === "上昇") {
    if (m5.trend === "下降") {
      direction = "ロング";
      entry = m5.current;
      tp = entry + 0.4;
      sl = entry - 0.2;
    }
  }

  else if (h4.trend === "下降" && h1.trend === "下降") {
    if (m5.trend === "上昇") {
      direction = "ショート";
      entry = m5.current;
      tp = entry - 0.4;
      sl = entry + 0.2;
    }
  }

  return { direction, entry, tp, sl, m5, h1, h4 };
}

// ===== LINE返信 =====
async function reply(token, text) {
  await axios.post(
    "https://api.line.me/v2/bot/message/reply",
    {
      replyToken: token,
      messages: [{ type: "text", text }]
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      }
    }
  );
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  // ★ここで1回だけ取得
  const prices = await getData();

  for (let event of events) {
    if (event.type === "message") {

      if (!prices) {
        await reply(event.replyToken, "データ取得失敗（APIキー・制限・通信エラー確認）");
        continue;
      }

      const trade = decide(prices);

      const message = `
【ポジション】
${trade.direction}

【現在】
${trade.m5.current.toFixed(2)}

【エントリー】
${trade.entry ? trade.entry.toFixed(2) : "-"}

【利確】
${trade.tp ? trade.tp.toFixed(2) : "-"}

【損切り】
${trade.sl ? trade.sl.toFixed(2) : "-"}

【相場状況】
・5分足：${trade.m5.trend}
・1時間足：${trade.h1.trend}
・4時間足：${trade.h4.trend}

【理由】
上位足と方向一致＋短期の押し目/戻りのみエントリー
`;

      await reply(event.replyToken, message);
    }
  }

  res.sendStatus(200);
});

app.listen(process.env.PORT || 3000, () => {
  console.log("サーバー起動");
});