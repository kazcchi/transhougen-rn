// functions/index.js

const {onRequest} = require("firebase-functions/v2/https");
const logger = require("firebase-functions/logger");
const functionsV1 = require("firebase-functions");
const cors = require("cors")({origin: true});
const OpenAI = require("openai");

// 環境変数 or Firebase config からキー取得
const apiKey =
  process.env.OPENAI_API_KEY ||
  functionsV1.config().openai.key;

if (!apiKey) {
  throw new Error(
      "OpenAI API key is missing. Set it via ENV or `firebase functions:config:set openai.key`.",
  );
}

const openai = new OpenAI({apiKey});

// Gen 2（v2）方式の HTTP トリガー
exports.dialectConverter = onRequest(
    {region: "us-central1"},
    async (req, res) => {
    // CORS対応
      cors(req, res, async () => {
        try {
          const {text} = req.body;
          if (!text) {
            return res
                .status(400)
                .json({error: "テキストを指定してください"});
          }

          // OpenAI に問い合わせ
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
              {
                role: "system",
                content:
                "あなたは方言変換アシスタントです。入力されたテキストを標準語に変換してください。",
              },
              {role: "user", content: text},
            ],
            temperature: 0.7,
          });

          return res.status(200).json({
            result: completion.choices[0].message.content,
          });
        } catch (e) {
          logger.error("Error in dialectConverter:", e);
          return res.status(500).json({error: e.message});
        }
      });
    },
);

