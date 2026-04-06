const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");

const app = express();
app.use(bodyParser.json());

// ===== 1回だけ取得 =====
async function getData() {
  try {
    const res = await axios.get(
      `https://api.twelvedata.com/time_series?symbol=USD/JPY&interval=5min&outputsize=60&apikey=${process.env.TWELVE_API_KEY}`
    );

    return res.data.values.map(v => parseFloat(v.close));

  } catch {
    return null;
  }
}

// ===== 時間足生成 =====
function buildTF(prices, size) {
  const chunk = prices.slice(0, size);
  const current = chunk[0];
  const avg = chunk.reduce((a,b)=>a+b,0)/chunk.length;

  let trend = "レンジ";
  if (current > avg) trend = "上昇";
  else if (current < avg) trend = "下降";

  return { current, avg, trend };
}

// ===== 判断 =====
function decide(data) {
  const m5 = buildTF(data, 5);
  const h1 = buildTF(data, 12);
  const h4 = buildTF(data, 48);

  let direction = "様子見";
  let entry = null;
  let tp = null;
  let sl = null;

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

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  const data = await getData();

  for (let event of events) {
    if (event.type === "message") {

      if (!data) {
        await reply(event.replyToken, "データ取得失敗");
        continue;
      }

      const trade = decide(data);

      const msg = `
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
上位足と方向一致＋短期押し目のみエントリー
`;

      await reply(event.replyToken, msg);
    }
  }

  res.sendStatus(200);
});

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

app.listen(process.env.PORT || 3000);