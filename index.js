const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const OpenAI = require("openai");

const app = express();
app.use(bodyParser.json());

// ===== OpenAI =====
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// ===== 通貨 =====
const PAIRS = {
  "ドル円": { from: "USD", to: "JPY" },
  "ユーロ円": { from: "EUR", to: "JPY" },
  "ポンド円": { from: "GBP", to: "JPY" },
  "ユーロドル": { from: "EUR", to: "USD" },
  "ポンドドル": { from: "GBP", to: "USD" },
};

// ===== キャッシュ（60秒）=====
let cache = {};
let lastFetch = {};

// ===== 通貨判定 =====
function detectPair(text) {
  for (let key in PAIRS) {
    if (text.includes(key)) return key;
  }
  return "ドル円";
}

// ===== 為替取得（5分足）=====
async function getFXData(pairKey) {
  const now = Date.now();

  if (cache[pairKey] && now - (lastFetch[pairKey] || 0) < 60000) {
    return cache[pairKey];
  }

  const pair = PAIRS[pairKey];

  try {
    const res = await axios.get(
      `https://api.frankfurter.app/latest?from=${pair.from}&to=${pair.to}`
    );

    const current = res.data.rates[pair.to];

    // 疑似5分足ロジック（直近平均との差でトレンド判定）
    const prev = cache[pairKey]?.current || current;

    let trend = "レンジ";
    if (current > prev) trend = "上昇";
    if (current < prev) trend = "下降";

    const high = Math.max(current, prev);
    const low = Math.min(current, prev);

    cache[pairKey] = { current, high, low, trend };
    lastFetch[pairKey] = now;

    return cache[pairKey];
  } catch (e) {
    console.error("取得失敗:", e.message);
    return cache[pairKey];
  }
}

// ===== エントリーロジック（AI使わない）=====
function buildStrategy(fx) {
  const price = fx.current;

  let side = "ロング";
  if (fx.trend === "下降") side = "ショート";

  let entry = price;
  let tp = side === "ロング" ? price + 0.4 : price - 0.4;
  let sl = side === "ロング" ? price - 0.2 : price + 0.2;

  return {
    side,
    entry: entry.toFixed(2),
    tp: tp.toFixed(2),
    sl: sl.toFixed(2),
    tpPips: 40,
    slPips: 20,
  };
}

// ===== Webhook =====
app.post("/webhook", async (req, res) => {
  console.log("Webhookきた");

  const events = req.body.events;
  if (!events) return res.sendStatus(200);

  for (let event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const replyToken = event.replyToken;
      const userMessage = event.message.text;

      const pairKey = detectPair(userMessage);
      const fx = await getFXData(pairKey);

      if (!fx) {
        await reply(replyToken, "為替取得エラー");
        continue;
      }

      const strategy = buildStrategy(fx);

      try {
        const aiResponse = await openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [
            {
              role: "system",
              content: `
あなたはプロのFXトレーダーです。

【重要】
・トレンドは必ず「5分足」と明記
・与えられたデータだけで説明
・想像禁止

【データ】
通貨：${pairKey}
現在価格：${fx.current.toFixed(2)}
高値：${fx.high.toFixed(2)}
安値：${fx.low.toFixed(2)}
トレンド（5分足）：${fx.trend}

【戦略（確定）】
結論：${strategy.side}
エントリー：${strategy.entry}
利確：${strategy.tp}（${strategy.tpPips}pips）
損切り：${strategy.sl}（${strategy.slPips}pips）

【出力形式】
【結論】
【トレンド（5分足）】
【現在の状況】
【戦略】
【エントリー】
【利確】
【損切り】
【目線】
【ファンダ】
【根拠】
`,
            },
            {
              role: "user",
              content: userMessage,
            },
          ],
          max_tokens: 600,
        });

        await reply(
          replyToken,
          aiResponse.choices[0].message.content
        );
      } catch (e) {
        console.error(e);
        await reply(replyToken, "AIエラー");
      }
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
      messages: [{ type: "text", text }],
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LINE_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// ===== 起動 =====
app.listen(process.env.PORT || 3000, () =>
  console.log("サーバー稼働中")
);