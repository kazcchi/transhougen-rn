// functions/appCheck.test.js
// 実行: node --test functions/
// App Check 検証（監視モード）の状態分類が仕様通りであることを固定するテスト。

const {test} = require("node:test");
const assert = require("node:assert/strict");
const {verifyAppCheckToken, APP_CHECK_HEADER} = require("./appCheck");

/**
 * フェイクの Express リクエストを作る。
 * @param {object} [headers] ヘッダー名→値
 * @return {{header: function(string): (string|undefined)}} フェイクリクエスト
 */
function fakeReq(headers = {}) {
  return {
    header: (name) => headers[name],
  };
}

test("ヘッダーなし → missing（verifier は呼ばれない）", async () => {
  let called = false;
  const verifier = async () => {
    called = true;
  };
  const status = await verifyAppCheckToken(fakeReq(), {verifier});
  assert.equal(status, "missing");
  assert.equal(called, false);
});

test("ヘッダーあり・verifier が resolve → valid", async () => {
  const req = fakeReq({[APP_CHECK_HEADER]: "valid-token"});
  const verifier = async () => ({appId: "dummy"});
  const status = await verifyAppCheckToken(req, {verifier});
  assert.equal(status, "valid");
});

test("ヘッダーあり・verifier が reject → invalid", async () => {
  const req = fakeReq({[APP_CHECK_HEADER]: "bad-token"});
  const verifier = async () => {
    throw new Error("invalid token");
  };
  const status = await verifyAppCheckToken(req, {verifier});
  assert.equal(status, "invalid");
});
