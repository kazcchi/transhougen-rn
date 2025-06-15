const functions = require("firebase-functions");
const cors = require("cors")({ origin: true });
const OpenAI = require("openai");

// 環境変数から OpenAI API キーを取得してクライアントを生成
const openai = new OpenAI({
  apiKey: functions.config().openai.key,
});

exports.dialectConverter = functions.https.onRequest(async (req, res) => {
  cors(req, res, async () => {
    try {
      const { text } = req.body;
      if (!text) {
        return res.status(400).json({ error: "テキストを指定してください" });
      }

      // v4 用の呼び出し
      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "あなたは方言変換アシスタントです。入力されたテキストを標準語に変換してください。",
          },
          {
            role: "user",
            content: text,
          },
        ],
        temperature: 0.7,
      });

      const converted = completion.choices[0].message.content;
      return res.status(200).json({ result: converted });
    } catch (error) {
      console.error("Error in dialectConverter:", error);
      return res.status(500).json({ error: error.message });
    }
  });
});

