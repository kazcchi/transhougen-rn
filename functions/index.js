// functions/index.js

const {onRequest} = require("firebase-functions/v2/https");
const {defineSecret} = require("firebase-functions/params");
const logger = require("firebase-functions/logger");
const cors = require("cors")({origin: true});
const OpenAI = require("openai");
const {toFile} = require("openai");
const busboy = require("busboy");

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
// type: "dialect"（地域方言）
const DIALECTS = {
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
};
const DEFAULT_DIALECT = "大阪弁";

// 方言→標準語 で任意に渡せる地方ヒント（粗い8区分）。
// 同綴異義語（例:「なおす」「えらい」）の解釈を地方で補正するためのもの。
// "auto" もしくはリスト外なら自動判別。
const REGIONS = [
  "北海道",
  "東北",
  "北陸",
  "関東",
  "中部",
  "近畿",
  "中国",
  "四国",
  "九州",
];

// 音声文字起こしの上限（コスト防御）
const MAX_AUDIO_BYTES = 2 * 1024 * 1024; // 約2MB（m4aで概ね30秒前後）

/**
 * 変換方向と方言からシステムプロンプトを組み立てる。
 * @param {string} direction "to_dialect"（標準語→方言）または
 *   "to_standard"（方言→標準語）
 * @param {string} dialect 対象の方言名
 * @param {string} [region] 方言→標準語のときの任意の地方ヒント
 * @return {string} OpenAI に渡すシステムプロンプト
 */
function buildSystemPrompt(direction, dialect, region) {
  if (direction === "to_dialect") {
    return [
      "あなたは方言変換の専門家です。",
      `入力された標準語の文章を、自然な${dialect}に変換してください。`,
      "意味やニュアンスは保ちつつ、その地方の人が実際に話すような",
      "自然な言い回し・語尾・イントネーションを反映してください。",
      "変換後の文章のみを出力し、解説や注釈は付けないでください。",
    ].join("");
  }
  // to_standard（方言/文体 → 標準語）
  // 方言は指定不要。任意の地方ヒントがあれば解釈を補正する。
  const regionHint = REGIONS.includes(region) ?
    `特に${region}地方の方言として解釈し、` :
    "";
  return [
    "あなたは日本語変換の専門家です。",
    "入力された文章には方言や独特の言い回しが混ざっていることがあります。",
    `${regionHint}意味やニュアンスを保ったまま自然な標準語に変換してください。`,
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

/**
 * リクエストからクライアントIPを取り出す。
 * @param {object} req Express リクエスト
 * @return {string} クライアントIP
 */
function getClientIp(req) {
  return (
    (req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    req.ip ||
    "unknown"
  );
}

/**
 * multipart/form-data から音声ファイルを1つ取り出す。
 * 上限を超えたら中断してエラーにする。
 * @param {object} req Express リクエスト（req.rawBody に本文）
 * @return {Promise<{buffer: Buffer, filename: string, mimeType: string}>}
 */
function parseAudioUpload(req) {
  return new Promise((resolve, reject) => {
    const bb = busboy({
      headers: req.headers,
      limits: {files: 1, fileSize: MAX_AUDIO_BYTES},
    });
    let fileInfo = null;
    const chunks = [];
    let tooLarge = false;

    bb.on("file", (_name, stream, info) => {
      fileInfo = info;
      stream.on("data", (d) => chunks.push(d));
      stream.on("limit", () => {
        tooLarge = true;
        stream.resume();
      });
    });
    bb.on("error", reject);
    bb.on("finish", () => {
      if (tooLarge) {
        return reject(new Error("AUDIO_TOO_LARGE"));
      }
      if (!fileInfo || chunks.length === 0) {
        return reject(new Error("NO_AUDIO"));
      }
      resolve({
        buffer: Buffer.concat(chunks),
        filename: fileInfo.filename || "audio.m4a",
        mimeType: fileInfo.mimeType || "audio/m4a",
      });
    });
    bb.end(req.rawBody);
  });
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
          const ip = getClientIp(req);
          if (isRateLimited(ip)) {
            logger.warn("Rate limit exceeded", {ip});
            return res.status(429).json({
              error: "リクエストが多すぎます。しばらくしてからお試しください。",
            });
          }

          // --- 入力バリデーション ---
          const {text, direction, dialect, region} = req.body || {};
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
                content: buildSystemPrompt(dir, selectedDialect, region),
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

// 音声文字起こし（方言→標準語の音声入力用）。
// multipart/form-data で "audio" フィールドに音声を受け取り、
// Whisper 系モデルで日本語テキストに起こして返す。
// 文字起こしと変換は分離し、ユーザーが誤認識を修正できるようにする。
exports.transcribeAudio = onRequest(
    {region: "us-central1", secrets: [openaiApiKey]},
    async (req, res) => {
      cors(req, res, async () => {
        try {
          if (req.method !== "POST") {
            return res.status(405).json({error: "POSTメソッドを使用してください"});
          }

          // --- レート制限（変換と同じストアを共用）---
          const ip = getClientIp(req);
          if (isRateLimited(ip)) {
            logger.warn("Rate limit exceeded (transcribe)", {ip});
            return res.status(429).json({
              error: "リクエストが多すぎます。しばらくしてからお試しください。",
            });
          }

          // --- 音声の取り出し ---
          let audio;
          try {
            audio = await parseAudioUpload(req);
          } catch (err) {
            if (err.message === "AUDIO_TOO_LARGE") {
              return res.status(413).json({
                error: "録音が長すぎます。30秒以内で録音してください。",
              });
            }
            return res.status(400).json({error: "音声を受け取れませんでした"});
          }

          // --- Whisper で文字起こし ---
          const openai = new OpenAI({apiKey: openaiApiKey.value()});
          const file = await toFile(audio.buffer, audio.filename, {
            type: audio.mimeType,
          });
          const transcription = await openai.audio.transcriptions.create({
            file,
            model: "gpt-4o-mini-transcribe",
            language: "ja",
          });

          return res.status(200).json({text: transcription.text || ""});
        } catch (e) {
          logger.error("Error in transcribeAudio:", e);
          return res.status(500).json({error: e.message});
        }
      });
    },
);

