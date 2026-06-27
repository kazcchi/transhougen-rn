// functions/index.js

const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const cors = require("cors")({origin: true});
const OpenAI = require("openai");

// OpenAI APIキーは Secret Manager で管理する（config() は廃止済み）
// 登録: firebase functions:secrets:set OPENAI_API_KEY
const openaiApiKey = defineSecret("OPENAI_API_KEY");

// ===== コスト防御の設定 =====
// 1回あたりの入力文字数の上限（トークン爆発を防ぐ）
const MAX_INPUT_CHARS = 300;
// 1回あたりの出力トークン上限（出力コストを固定）
const MAX_OUTPUT_TOKENS = 500;
// 簡易レート制限：同一IPあたりの許可回数 / 時間窓
const RATE_LIMIT_MAX = 30; // 回
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1時間

// 簡易レート制限用のメモリ内ストア（ベストエフォート）
// 注: Cloud Functions はインスタンスが複数/再起動しうるため厳密ではない。
// 本格的な制限は App Check / Firestore で別途実施する。
const rateStore = new Map();

// 対応する変換先（フロントの選択肢と一致させる）
// type: "dialect"（地域方言）/ "style"（文体・話し方）
// hint: プロンプトに渡す補足（番外編の品質を安定させる）
const DIALECTS = {
  // ---- 主要（地域方言） ----
  "北海道弁": {type: "dialect"},
  "津軽弁": {type: "dialect"},
  "仙台弁": {type: "dialect"},
  "江戸弁": {type: "dialect"},
  "名古屋弁": {type: "dialect"},
  "京都弁": {type: "dialect"},
  "大阪弁": {type: "dialect"},
  "神戸弁": {type: "dialect"},
  "金沢弁": {type: "dialect"},
  "岡山弁": {type: "dialect"},
  "広島弁": {type: "dialect"},
  "伊予弁": {type: "dialect"},
  "土佐弁": {type: "dialect"},
  "博多弁": {type: "dialect"},
  "熊本弁": {type: "dialect"},
  "鹿児島弁": {type: "dialect"},
  // ---- 番外編 ----
  "河内弁": {type: "dialect", hint: "ガラの強い威勢のいい言い回し"},
  "お嬢様言葉": {
    type: "style",
    hint: "上品で丁寧な「〜ですわ」「〜ますの」調",
  },
  "武士語": {
    type: "style",
    hint: "時代劇の侍のような「〜でござる」「拙者」調",
  },
  "オネエ言葉": {
    type: "style",
    hint: "華やかで親しみやすい「〜なのよ」「〜だわ」調",
  },
};
const DEFAULT_DIALECT = "大阪弁";

/**
 * 変換方向と方言/文体からシステムプロンプトを組み立てる。
 * @param {string} direction "to_dialect"（標準語→方言）または
 *   "to_standard"（方言→標準語）
 * @param {string} dialect 対象の方言/文体名
 * @return {string} OpenAI に渡すシステムプロンプト
 */
function buildSystemPrompt(direction, dialect) {
  const meta = DIALECTS[dialect] || {type: "dialect"};
  const hint = meta.hint ? `（${meta.hint}）` : "";

  if (direction === "to_dialect") {
    if (meta.type === "style") {
      return [
        "あなたは文体変換の専門家です。",
        `入力された文章を、${dialect}${hint}の話し方に変換してください。`,
        "意味は保ちつつ、その話し方らしい語尾・言い回しを自然に反映し、",
        "誰かを揶揄するのではなく明るく楽しい雰囲気にしてください。",
        "変換後の文章のみを出力し、解説や注釈は付けないでください。",
      ].join("");
    }
    return [
      "あなたは方言変換の専門家です。",
      `入力された標準語の文章を、自然な${dialect}${hint}に変換してください。`,
      "意味やニュアンスは保ちつつ、その地方の人が実際に話すような",
      "自然な言い回し・語尾・イントネーションを反映してください。",
      "変換後の文章のみを出力し、解説や注釈は付けないでください。",
    ].join("");
  }
  // to_standard（方言/文体 → 標準語）
  return [
    "あなたは日本語変換の専門家です。",
    `入力された${dialect}（その他の方言や独特の話し方が混ざっていても可）の`,
    "文章を、意味を保ったまま自然な標準語に変換してください。",
    "変換後の文章のみを出力し、解説や注釈は付けないでください。",
  ].join("");
}

/**
 * 同一IPの直近リクエスト数で簡易的にレート制限する。
 * @param {string} ip クライアントIP
 * @return {boolean} 上限超過なら true
 */
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateStore.get(ip) || [];
  // 時間窓外の古い記録を捨てる
  const recent = entry.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  recent.push(now);
  rateStore.set(ip, recent);
  return recent.length > RATE_LIMIT_MAX;
}

// Gen 2（v2）方式の HTTP トリガー
exports.dialectConverter = onRequest(
    {region: "us-central1", secrets: [openaiApiKey]},
    async (req, res) => {
    // CORS対応
      cors(req, res, async () => {
        try {
          // OpenAI クライアント（キーは実行時に Secret から取得）
          const openai = new OpenAI({apiKey: openaiApiKey.value()});

          // --- レート制限 ---
          const ip =
            (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
            req.ip ||
            "unknown";
          if (isRateLimited(ip)) {
            logger.warn("Rate limit exceeded", {ip});
            return res.status(429).json({
              error: "リクエストが多すぎます。しばらくしてからお試しください。",
            });
          }

          // --- 入力バリデーション ---
          const {text, direction, dialect} = req.body || {};
          if (!text || typeof text !== "string" || !text.trim()) {
            return res
                .status(400)
                .json({error: "テキストを指定してください"});
          }
          if (text.length > MAX_INPUT_CHARS) {
            return res.status(400).json({
              error: `テキストは${MAX_INPUT_CHARS}文字以内で入力してください。`,
            });
          }

          // 方向は to_dialect / to_standard のみ許可（既定は標準語化）
          const dir = direction === "to_dialect" ? "to_dialect" : "to_standard";
          // 方言/文体は許可リスト内のみ。未指定/不正なら既定値にフォールバック
          const selectedDialect =
            Object.prototype.hasOwnProperty.call(DIALECTS, dialect) ?
              dialect :
              DEFAULT_DIALECT;

          // OpenAI に問い合わせ
          const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            max_tokens: MAX_OUTPUT_TOKENS,
            messages: [
              {
                role: "system",
                content: buildSystemPrompt(dir, selectedDialect),
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

