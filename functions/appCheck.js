// functions/appCheck.js

const {getAppCheck} = require("firebase-admin/app-check");

// クライアントが App Check トークンを載せるヘッダー名
const APP_CHECK_HEADER = "X-Firebase-AppCheck";

/**
 * リクエストの App Check トークンを検証し、状態を返す。
 * 監視モード（強制しない）でも呼び出してログに使えるよう、
 * 拒否の判断はせず状態の分類のみを行う。
 * @param {object} req Express リクエスト
 * @param {object} [opts] オプション
 * @param {function(string): Promise<*>} [opts.verifier]
 *   テスト用に注入できる検証関数（省略時は firebase-admin を使用）
 * @return {Promise<"valid"|"missing"|"invalid">} 検証結果
 */
async function verifyAppCheckToken(req, {verifier} = {}) {
  const token = req.header(APP_CHECK_HEADER);
  if (!token || typeof token !== "string") {
    return "missing";
  }
  try {
    const verify = verifier || ((t) => getAppCheck().verifyToken(t));
    await verify(token);
    return "valid";
  } catch (e) {
    return "invalid";
  }
}

module.exports = {verifyAppCheckToken, APP_CHECK_HEADER};
