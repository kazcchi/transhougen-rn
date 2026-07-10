// appCheck.web.ts
// Web 専用: Firebase App Check（reCAPTCHA v3）のトークン取得。
// ネイティブ（iOS/Android）では同名の appCheck.ts が使われる（Metro の .web 解決）。
import { initializeApp } from "firebase/app";
import {
  initializeAppCheck,
  ReCaptchaV3Provider,
  getToken,
} from "firebase/app-check";
import type { AppCheck } from "firebase/app-check";

// Firebase Web アプリの公開設定（秘密情報ではない）
const firebaseConfig = {
  apiKey: "AIzaSyDk9Tv7fW-LmAT0a0Q-SJus1DUjRmuqUYE",
  authDomain: "transhougen.firebaseapp.com",
  projectId: "transhougen",
  storageBucket: "transhougen.firebasestorage.app",
  messagingSenderId: "865010632525",
  appId: "1:865010632525:web:e542c6c8463a454b699904",
};

// reCAPTCHA v3 のサイトキー（公開情報）
const RECAPTCHA_SITE_KEY = "6LeIIkwtAAAAAMrdf5u4iqEM8Zp4XbkO9MMZzczf";

let appCheck: AppCheck | null = null;
let initFailed = false;

function ensureAppCheck(): AppCheck | null {
  if (appCheck || initFailed) return appCheck;
  if (RECAPTCHA_SITE_KEY.startsWith("__")) return null;
  try {
    // 開発時（localhost）はデバッグトークンを使う。
    // 初回にブラウザのコンソールへ出力されるトークンを
    // Firebase Console → App Check → デバッグトークンに登録する。
    if (__DEV__) {
      (globalThis as Record<string, unknown>).FIREBASE_APPCHECK_DEBUG_TOKEN =
        true;
    }
    const app = initializeApp(firebaseConfig);
    appCheck = initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(RECAPTCHA_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // 初期化失敗時はトークンなしで動作継続（拒否判断はサーバー側に集約）
    initFailed = true;
    appCheck = null;
  }
  return appCheck;
}

/**
 * App Check トークンを取得する。取得できない場合は null。
 * （リクエスト自体は送る。強制化前はサーバーが監視ログのみ記録する）
 */
export async function getAppCheckToken(): Promise<string | null> {
  try {
    const instance = ensureAppCheck();
    if (!instance) return null;
    const { token } = await getToken(instance, false);
    return token || null;
  } catch {
    return null;
  }
}
