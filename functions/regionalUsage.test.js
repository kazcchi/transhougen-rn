// functions/regionalUsage.test.js
// 実行: node --test functions/
// 地域差検出ロジックの仕様（誤検出しないことを含む）を固定するテスト。

const {test} = require("node:test");
const assert = require("node:assert");
const {detectRegionalUsage, REGIONAL_USAGE_ENTRIES, MAX_NOTES} = require("./regionalUsage");

const ids = (hits) => hits.map((h) => h.id);

// ===== 方言→標準語（to_standard） =====

test("手袋を履く＋北海道 → 手袋エントリを検出", () => {
  const hits = detectRegionalUsage("寒いから手袋を履いていきなさい", "to_standard", {region: "北海道"});
  assert.deepStrictEqual(ids(hits), ["hokkaido_tebukuro_haku"]);
});

test("手袋を履く はおまかせでも検出（matchInAuto: true）", () => {
  const hits = detectRegionalUsage("手袋履かないと寒いよ", "to_standard", {});
  assert.deepStrictEqual(ids(hits), ["hokkaido_tebukuro_haku"]);
});

test("ゴミを投げる＋東北 → ゴミエントリを検出", () => {
  const hits = detectRegionalUsage("このゴミ投げておいて", "to_standard", {region: "東北"});
  assert.deepStrictEqual(ids(hits), ["hokkaido_tohoku_gomi_nageru"]);
});

test("ゴミを投げる＋対象外の地方（九州）→ 検出しない", () => {
  const hits = detectRegionalUsage("このゴミ投げておいて", "to_standard", {region: "九州"});
  assert.deepStrictEqual(hits, []);
});

test("鍵をかった＋中部 → 鍵エントリを検出", () => {
  const hits = detectRegionalUsage("玄関の鍵かった？", "to_standard", {region: "中部"});
  assert.deepStrictEqual(ids(hits), ["chubu_kagi_kau"]);
});

test("鍵をかう はおまかせでは検出しない（「買う」と紛らわしいため）", () => {
  const hits = detectRegionalUsage("玄関の鍵かった？", "to_standard", {region: "auto"});
  assert.deepStrictEqual(hits, []);
});

test("机をつって＋中部 → 机エントリを検出", () => {
  const hits = detectRegionalUsage("掃除の前に机をつって", "to_standard", {region: "中部"});
  assert.deepStrictEqual(ids(hits), ["chubu_tsukue_tsuru"]);
});

test("荷物をからう＋九州 → からうエントリを検出", () => {
  const hits = detectRegionalUsage("この荷物をからって行く", "to_standard", {region: "九州"});
  assert.deepStrictEqual(ids(hits), ["kyushu_karau"]);
});

test("なおしといて＋近畿 → なおすエントリを検出", () => {
  const hits = detectRegionalUsage("これなおしといて", "to_standard", {region: "近畿"});
  assert.deepStrictEqual(ids(hits), ["nishinihon_naosu_katazukeru"]);
});

test("なおす はおまかせでは検出しない（標準語「直す」と衝突するため）", () => {
  const hits = detectRegionalUsage("これなおしといて", "to_standard", {});
  assert.deepStrictEqual(hits, []);
});

test("体がこわい＋おまかせ → こわいエントリを検出", () => {
  const hits = detectRegionalUsage("今日は働きすぎて体がこわい", "to_standard", {});
  assert.deepStrictEqual(ids(hits), ["hokkaido_tohoku_karada_kowai"]);
});

// ===== 誤検出しないこと =====

test("通常文では何も検出しない", () => {
  const hits = detectRegionalUsage("今日はとても疲れました", "to_standard", {});
  assert.deepStrictEqual(hits, []);
});

test("「だからって」は からう に誤マッチしない", () => {
  const hits = detectRegionalUsage("疲れたからって休むな", "to_standard", {region: "九州"});
  assert.deepStrictEqual(hits, []);
});

test("「誤字を直して」は なおす に誤マッチしない", () => {
  const hits = detectRegionalUsage("この誤字を直しておいて", "to_standard", {region: "近畿"});
  assert.deepStrictEqual(hits, []);
});

test("「お化けがこわい」は こわい に誤マッチしない", () => {
  const hits = detectRegionalUsage("お化けがこわい", "to_standard", {});
  assert.deepStrictEqual(hits, []);
});

test("「そのほかすべて」は ほかす に誤マッチしない", () => {
  const hits = detectRegionalUsage("そのほかすべて捨てた", "to_standard", {region: "近畿"});
  assert.deepStrictEqual(hits, []);
});

// ===== 標準語→方言（to_dialect）の逆引き =====

test("手袋をはめて＋北海道弁 → 手袋エントリを検出", () => {
  const hits = detectRegionalUsage("手袋をはめていきなさい", "to_dialect", {dialect: "北海道弁"});
  assert.deepStrictEqual(ids(hits), ["hokkaido_tebukuro_haku"]);
});

test("手袋をはめて＋大阪弁 → 検出しない（対象外方言）", () => {
  const hits = detectRegionalUsage("手袋をはめていきなさい", "to_dialect", {dialect: "大阪弁"});
  assert.deepStrictEqual(hits, []);
});

test("ゴミを捨てて＋仙台弁 → ゴミエントリを検出", () => {
  const hits = detectRegionalUsage("そのゴミを捨てておいて", "to_dialect", {dialect: "仙台弁"});
  assert.deepStrictEqual(ids(hits), ["hokkaido_tohoku_gomi_nageru"]);
});

test("片付けて＋大阪弁 → なおすエントリを検出", () => {
  const hits = detectRegionalUsage("机の上を片付けておいて", "to_dialect", {dialect: "大阪弁"});
  assert.deepStrictEqual(ids(hits), ["nishinihon_naosu_katazukeru"]);
});

// ===== 上限・安全性 =====

test("複数ヒットしても最大2件まで", () => {
  const text = "手袋を履いてゴミを投げて体がこわい";
  const hits = detectRegionalUsage(text, "to_standard", {region: "北海道"});
  assert.strictEqual(hits.length, MAX_NOTES);
});

test("不正な入力でも落ちずに空配列を返す", () => {
  assert.deepStrictEqual(detectRegionalUsage(null, "to_standard", {}), []);
  assert.deepStrictEqual(detectRegionalUsage("", "to_standard"), []);
  assert.deepStrictEqual(detectRegionalUsage(123, "to_dialect", {dialect: "大阪弁"}), []);
  assert.deepStrictEqual(detectRegionalUsage("手袋を履く", "to_dialect", {}), []);
});

// ===== 辞書データ自体の整合性 =====

test("辞書の regions / dialects は正規タクソノミーのみを使う", () => {
  const REGIONS = ["北海道", "東北", "北陸", "関東", "中部", "近畿", "中国", "四国", "九州"];
  const DIALECTS = [
    "北海道弁", "津軽弁", "仙台弁", "江戸弁", "名古屋弁", "京都弁", "大阪弁", "神戸弁",
    "金沢弁", "岡山弁", "広島弁", "伊予弁", "土佐弁", "博多弁", "熊本弁", "鹿児島弁",
  ];
  for (const entry of REGIONAL_USAGE_ENTRIES) {
    for (const r of entry.regions) {
      assert.ok(REGIONS.includes(r), `${entry.id}: 不正な地方名 ${r}`);
    }
    for (const d of entry.dialects) {
      assert.ok(DIALECTS.includes(d), `${entry.id}: 不正な方言名 ${d}`);
    }
    assert.ok(entry.dialectPatterns.length > 0, `${entry.id}: dialectPatterns が空`);
    assert.ok(entry.note, `${entry.id}: note が空`);
    assert.strictEqual(typeof entry.matchInAuto, "boolean", `${entry.id}: matchInAuto がない`);
  }
});

test("id は重複しない", () => {
  const all = REGIONAL_USAGE_ENTRIES.map((e) => e.id);
  assert.strictEqual(new Set(all).size, all.length);
});
