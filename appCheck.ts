// appCheck.ts
// ネイティブ（iOS/Android）用スタブ。App Check は未対応のため常に null。
// iOS は Apple Developer 承認後に App Attest（@react-native-firebase/app-check）で対応予定。

/**
 * App Check トークンを取得する（ネイティブは未対応のため常に null）。
 */
export async function getAppCheckToken(): Promise<string | null> {
  return null;
}
