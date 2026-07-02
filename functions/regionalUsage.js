// functions/regionalUsage.js
//
// 地域差メモ辞書と検出ロジック。
// 「同じ言葉でも地域によって意味や使い方が違う」表現を検出し、
// 変換プロンプトの補正と、ユーザー向け「地域メモ」表示に使う。
//
// 設計メモ:
// - regions / dialects はアプリの正規タクソノミー（9地方・16方言）のみを使う。
//   都道府県名は使わない（UIに存在しない選択肢はマッチ対象にならないため）。
// - パターンは活用形を拾えるよう「語幹」まで（例:「手袋を履」は 履く/履いて/履いた に一致）。
// - 「なおす」のような標準語と衝突する汎用語は matchInAuto: false にして、
//   ユーザーが該当地方を明示的に選んだときだけ照合する（おまかせ時の誤検出防止）。
// - 検出結果はプロンプトへのヒント注入に使うだけで、機械的な文字列置換はしない。
//   意味の最終判断は文脈を見られる LLM に委ねる。

/**
 * 地域差メモ辞書のエントリ構造:
 * @typedef {object} RegionalUsageEntry
 * @property {string} id 一意なID
 * @property {string[]} regions 対象地方（9地方の名称のみ）
 * @property {string[]} dialects 対象方言（16方言の名称のみ）
 * @property {string[]} dialectPatterns 方言側の表現（方言→標準語の入力と照合。語幹可）
 * @property {string[]} standardPatterns 標準語側の表現（標準語→方言の入力と照合。語幹可）
 * @property {string} localUsage 地域での言い方
 * @property {string} standardMeaning 標準語での意味
 * @property {string} note ユーザー向けの地域メモ本文
 * @property {string[]} examples 使用例
 * @property {string} category "meaning_shift"|"verb_usage"|"phrase"|"vocabulary"
 * @property {boolean} matchInAuto 地方未選択（おまかせ）でも照合してよいか。
 *   標準語と紛らわしい語は false にする。
 */

/** @type {RegionalUsageEntry[]} */
const REGIONAL_USAGE_ENTRIES = [
  {
    id: "hokkaido_tebukuro_haku",
    regions: ["北海道", "東北"],
    dialects: ["北海道弁", "津軽弁"],
    dialectPatterns: [
      "手袋を履", "手袋履", "てぶくろを履", "てぶくろ履",
      "手袋をはい", "手袋はい", "手袋をはく", "手袋はく", "手袋をはき", "手袋はき",
    ],
    standardPatterns: [
      "手袋をはめ", "手袋はめ", "手袋をつけ", "手袋をして", "手袋をする",
      "てぶくろをはめ",
    ],
    localUsage: "手袋を履く",
    standardMeaning: "手袋をはめる／手袋をする",
    note: "北海道や東北の一部では、手袋を身につけることを「履く」と言うことがあります。他地域では「手袋をはめる」「手袋をする」が一般的です。",
    examples: ["寒いから手袋を履いていきなさい", "手袋履かないと寒いよ"],
    category: "verb_usage",
    matchInAuto: true,
  },
  {
    id: "hokkaido_tohoku_gomi_nageru",
    regions: ["北海道", "東北"],
    dialects: ["北海道弁", "津軽弁", "仙台弁"],
    dialectPatterns: [
      "ゴミを投げ", "ごみを投げ", "ゴミ投げ", "ごみ投げ",
      "ゴミをなげ", "ごみをなげ", "ゴミなげ", "ごみなげ",
    ],
    standardPatterns: [
      "ゴミを捨て", "ごみを捨て", "ゴミ捨て", "ごみ捨て",
      "ゴミをすて", "ごみをすて",
    ],
    localUsage: "ゴミを投げる",
    standardMeaning: "ゴミを捨てる",
    note: "北海道や東北では「ゴミを投げる」が「ゴミを捨てる」という意味で使われます。放り投げるという意味ではありません。",
    examples: ["このゴミ投げておいて", "ゴミを投げに行く"],
    category: "meaning_shift",
    matchInAuto: true,
  },
  {
    id: "hokkaido_tohoku_karada_kowai",
    regions: ["北海道", "東北"],
    dialects: ["北海道弁", "津軽弁", "仙台弁"],
    dialectPatterns: [
      "体がこわい", "からだがこわい", "身体がこわい", "体こわい", "からだこわい",
    ],
    // 標準語側の「疲れた」は高頻度すぎて逆引きすると出すぎるため対象外にする
    standardPatterns: [],
    localUsage: "（体が）こわい",
    standardMeaning: "（体が）疲れた・だるい",
    note: "北海道や東北では「こわい」が「疲れた・だるい」という意味で使われることがあります。「恐ろしい」という意味ではありません。",
    examples: ["今日は働きすぎて体がこわい", "階段を上ったら体こわいわ"],
    category: "meaning_shift",
    matchInAuto: true,
  },
  {
    id: "kanto_katasu",
    regions: ["関東"],
    dialects: ["江戸弁"],
    dialectPatterns: [
      "をかたして", "をかたす", "かたしといて", "かたしとけ", "かたしておいて",
    ],
    standardPatterns: [],
    localUsage: "かたす",
    standardMeaning: "片付ける",
    note: "「かたす」は関東で使われる言い方で、「片付ける」という意味です。西日本ではあまり通じないことがあります。",
    examples: ["机の上をかたして", "おもちゃをかたしといて"],
    category: "vocabulary",
    matchInAuto: true,
  },
  {
    id: "chubu_kagi_kau",
    regions: ["中部"],
    dialects: ["名古屋弁"],
    dialectPatterns: [
      "鍵をかう", "鍵かう", "鍵をかって", "鍵かって", "鍵をかった", "鍵かった",
      "カギをかう", "かぎをかう", "カギかって", "かぎかって",
    ],
    standardPatterns: [
      "鍵をかけ", "鍵かけ", "カギをかけ", "かぎをかけ", "施錠",
    ],
    localUsage: "鍵をかう",
    standardMeaning: "鍵をかける",
    note: "東海地方などでは「鍵をかう」が「鍵をかける」という意味で使われます。「買う」ではなく、突っ支い棒で「支う（かう）」に由来すると言われます。",
    examples: ["玄関の鍵をかっておいて", "鍵かった？"],
    category: "verb_usage",
    // 「鍵をかう」は「鍵を買う」とも読めるため、中部を明示選択したときだけ照合する
    matchInAuto: false,
  },
  {
    id: "chubu_tsukue_tsuru",
    regions: ["中部"],
    dialects: ["名古屋弁"],
    dialectPatterns: [
      "机をつる", "机つる", "机をつって", "机つって", "机をつった", "机つった",
      "つくえをつる", "つくえをつって",
    ],
    standardPatterns: [
      "机を運ん", "机を運ぶ", "机運ぶ", "机を持ち上げ",
    ],
    localUsage: "机をつる",
    standardMeaning: "机を運ぶ",
    note: "東海地方などでは「机をつる」が「机を（持ち上げて）運ぶ」という意味で使われます。学校の掃除の時間などによく使われる言い方です。",
    examples: ["掃除の前に机をつって", "机つるの手伝って"],
    category: "meaning_shift",
    matchInAuto: true,
  },
  {
    id: "chubu_erai_tsukareta",
    regions: ["中部", "北陸"],
    dialects: ["名古屋弁", "金沢弁"],
    dialectPatterns: [
      "体がえらい", "からだがえらい", "身体がえらい", "えらくてかなわん", "えらいわ",
    ],
    standardPatterns: [],
    localUsage: "えらい",
    standardMeaning: "疲れた・しんどい",
    note: "東海・北陸などでは「えらい」が「疲れた・しんどい」という意味で使われることがあります。「立派だ」という意味ではありません。",
    examples: ["今日は仕事が忙しくて体がえらい", "坂道を上るとえらいわ"],
    category: "meaning_shift",
    // 「えらい」は標準語の「偉い」と紛らわしいため、地方を明示選択したときだけ照合する
    matchInAuto: false,
  },
  {
    id: "nishinihon_naosu_katazukeru",
    regions: ["近畿", "中国", "四国", "九州"],
    dialects: [
      "京都弁", "大阪弁", "神戸弁", "岡山弁", "広島弁",
      "伊予弁", "土佐弁", "博多弁", "熊本弁", "鹿児島弁",
    ],
    dialectPatterns: [
      "なおしといて", "なおしとって", "なおしとき", "をなおして", "なおしんさい",
    ],
    standardPatterns: [
      "片付けて", "片づけて", "かたづけて", "片付けと", "しまっておいて", "しまっとい",
    ],
    localUsage: "なおす",
    standardMeaning: "片付ける・しまう",
    note: "近畿や九州など西日本では「なおす」が「片付ける・しまう」という意味で使われます。「修理する」という意味とは文脈で区別されます。",
    examples: ["これなおしといて", "机の上のものをなおして"],
    category: "meaning_shift",
    // 「なおす」は標準語の「直す（修理する）」と衝突するため、地方を明示選択したときだけ照合する
    matchInAuto: false,
  },
  {
    id: "kinki_hokasu_suteru",
    regions: ["近畿"],
    dialects: ["京都弁", "大阪弁", "神戸弁"],
    dialectPatterns: [
      "をほかして", "をほかす", "をほかした", "ほかしといて", "ほかしとき", "ほかしてもうた",
    ],
    standardPatterns: [],
    localUsage: "ほかす",
    standardMeaning: "捨てる",
    note: "関西では「ほかす」が「捨てる」という意味で使われます。「保管す（ほかんす）」と聞き間違えると意味が逆になるので注意される表現です。",
    examples: ["そのゴミほかしといて", "古い雑誌をほかした"],
    category: "vocabulary",
    matchInAuto: true,
  },
  {
    id: "kyushu_karau",
    regions: ["九州"],
    dialects: ["博多弁", "熊本弁", "鹿児島弁"],
    dialectPatterns: [
      "をからう", "をからって", "をからった", "ランドセルからう", "荷物からう",
    ],
    standardPatterns: [
      "背負って", "背負う", "背負った", "リュックをしょっ",
    ],
    localUsage: "からう",
    standardMeaning: "背負う",
    note: "九州では「からう」が「（リュックやランドセルを）背負う」という意味で使われます。「からかう」とは別の言葉です。",
    examples: ["ランドセルをからって行きなさい", "この荷物をからう"],
    category: "vocabulary",
    matchInAuto: true,
  },
];

// 1回の変換で返す地域メモの最大件数（出しすぎると補助情報の域を超えるため）
const MAX_NOTES = 2;

/**
 * 入力文・変換方向・選択地域から、該当する地域差エントリを検出する。
 * 例外時は空配列を返し、呼び出し側（変換処理）を止めない。
 *
 * @param {string} text 入力文
 * @param {string} direction "to_dialect"（標準語→方言）| "to_standard"（方言→標準語）
 * @param {object} [options] 選択状態
 * @param {string} [options.dialect] to_dialect のときの変換先方言（16方言の名称）
 * @param {string} [options.region] to_standard のときの地方ヒント（9地方の名称。未指定/"auto"=おまかせ）
 * @return {RegionalUsageEntry[]} 該当エントリ（最大 MAX_NOTES 件、note 重複なし）
 */
function detectRegionalUsage(text, direction, options = {}) {
  try {
    if (!text || typeof text !== "string") {
      return [];
    }
    const {dialect, region} = options;
    const hits = [];
    for (const entry of REGIONAL_USAGE_ENTRIES) {
      if (direction === "to_dialect") {
        // 標準語→方言: 変換先方言が対象で、標準語側の表現が入力に含まれるか
        if (!entry.dialects.includes(dialect)) continue;
        if (!entry.standardPatterns.some((p) => text.includes(p))) continue;
      } else {
        // 方言→標準語: 地方ヒントが対象地方か（おまかせは matchInAuto のみ）
        const isAuto = !region || region === "auto";
        const regionOk = isAuto ? entry.matchInAuto : entry.regions.includes(region);
        if (!regionOk) continue;
        if (!entry.dialectPatterns.some((p) => text.includes(p))) continue;
      }
      // 同じ note は重複させない
      if (hits.some((h) => h.note === entry.note)) continue;
      hits.push(entry);
      if (hits.length >= MAX_NOTES) break;
    }
    return hits;
  } catch (e) {
    // 検出はあくまで補助機能。失敗しても変換自体は続行させる
    return [];
  }
}

module.exports = {
  REGIONAL_USAGE_ENTRIES,
  detectRegionalUsage,
  MAX_NOTES,
};
