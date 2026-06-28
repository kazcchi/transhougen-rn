// App.tsx
import React, { useState } from "react";
import {
  StyleSheet,
  TextInput,
  ScrollView,
  View,
  Text,
  Pressable,
  useColorScheme,
  Platform,
  ActivityIndicator,
  StatusBar,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import {
  useAudioRecorder,
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
} from "expo-audio";

const ENDPOINT =
  "https://us-central1-transhougen.cloudfunctions.net/dialectConverter";
const TRANSCRIBE_ENDPOINT =
  "https://us-central1-transhougen.cloudfunctions.net/transcribeAudio";

const MAX_CHARS = 300;

// 方言→標準語のときに任意で渡す地方ヒント（粗い8区分）。
// 「おまかせ」は自動判別（地方未指定）。
const REGION_AUTO = "auto";
const REGIONS = [
  "北海道",
  "東北",
  "関東",
  "中部",
  "近畿",
  "中国",
  "四国",
  "九州",
] as const;

// 主要（地域方言・北→南）
const MAIN_DIALECTS = [
  "北海道弁",
  "津軽弁",
  "仙台弁",
  "江戸弁",
  "名古屋弁",
  "京都弁",
  "大阪弁",
  "神戸弁",
  "金沢弁",
  "岡山弁",
  "広島弁",
  "伊予弁",
  "土佐弁",
  "博多弁",
  "熊本弁",
  "鹿児島弁",
] as const;

// 番外編（ネタ・遊び枠）
const BONUS_DIALECTS = [
  "河内弁",
  "お嬢様言葉",
  "武士語",
  "オネエ言葉",
] as const;

type Direction = "to_dialect" | "to_standard";

// ===== カラーテーマ（ダーク/ライト） =====
const palette = {
  light: {
    bg: "#f5f6f8",
    card: "#ffffff",
    text: "#1a1a1a",
    subText: "#6b7280",
    border: "#e5e7eb",
    inputBg: "#ffffff",
    accent: "#4f46e5",
    accentText: "#ffffff",
    chipBg: "#eef0f4",
    chipText: "#374151",
    segBg: "#eef0f4",
  },
  dark: {
    bg: "#0f1115",
    card: "#1a1d24",
    text: "#f3f4f6",
    subText: "#9ca3af",
    border: "#2b2f38",
    inputBg: "#13161c",
    accent: "#6366f1",
    accentText: "#ffffff",
    chipBg: "#262a33",
    chipText: "#d1d5db",
    segBg: "#262a33",
  },
};

export default function App() {
  const scheme = useColorScheme();
  const c = scheme === "dark" ? palette.dark : palette.light;

  const [input, setInput] = useState("");
  const [converted, setConverted] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [direction, setDirection] = useState<Direction>("to_standard");
  const [dialect, setDialect] = useState<string>(MAIN_DIALECTS[6]); // 大阪弁
  const [region, setRegion] = useState<string>(REGION_AUTO);
  const [copied, setCopied] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const handleConvert = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setConverted("");
    setError("");
    setCopied(false);
    try {
      // 方言→標準語のときだけ地方ヒントを付ける（おまかせなら送らない）
      const body: Record<string, string> = { text: input, direction, dialect };
      if (direction === "to_standard" && region !== REGION_AUTO) {
        body.region = region;
      }
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "変換に失敗しました");
      } else {
        setConverted(data.result ?? "");
      }
    } catch {
      setError("通信エラーが発生しました。電波状況をご確認ください。");
    } finally {
      setLoading(false);
    }
  };

  // 録音開始：権限確認 → 録音モード → 録音
  const handleStartRecording = async () => {
    if (recording || transcribing || loading) return;
    setError("");
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setError("マイクの使用が許可されていません。設定をご確認ください。");
        return;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record();
      setRecording(true);
    } catch {
      setError("録音を開始できませんでした。");
    }
  };

  // 録音停止 → 音声をアップロードして文字起こし → 入力欄へ反映
  const handleStopRecording = async () => {
    if (!recording) return;
    setRecording(false);
    setTranscribing(true);
    try {
      await recorder.stop();
      const uri = recorder.uri;
      if (!uri) {
        setError("録音データを取得できませんでした。");
        return;
      }

      const formData = new FormData();
      if (Platform.OS === "web") {
        const blob = await (await fetch(uri)).blob();
        // web の FormData は (name, blob, filename) の3引数を受け付ける
        (formData.append as (n: string, v: Blob, f: string) => void)(
          "audio",
          blob,
          "audio.webm",
        );
      } else {
        // React Native の fetch はこの形の file オブジェクトを受け付ける
        formData.append("audio", {
          uri,
          name: "audio.m4a",
          type: "audio/m4a",
        } as unknown as Blob);
      }

      const res = await fetch(TRANSCRIBE_ENDPOINT, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "文字起こしに失敗しました");
        return;
      }
      const text = (data.text ?? "").slice(0, MAX_CHARS);
      // 既存入力に追記（複数回しゃべれるように）
      setInput((prev) => (prev ? `${prev} ${text}` : text).slice(0, MAX_CHARS));
    } catch {
      setError("文字起こし中にエラーが発生しました。");
    } finally {
      setTranscribing(false);
    }
  };

  const handleCopy = async () => {
    if (!converted) return;
    await Clipboard.setStringAsync(converted);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleSwap = () => {
    setDirection((d) => (d === "to_dialect" ? "to_standard" : "to_dialect"));
    // 入力欄に直前の変換結果があれば入れ替えて続けて変換しやすくする
    if (converted) {
      setInput(converted);
      setConverted("");
      setError("");
    }
  };

  const handleClear = () => {
    setInput("");
    setConverted("");
    setError("");
    setCopied(false);
  };

  const inputLabel =
    direction === "to_dialect" ? "標準語を入力" : "方言を入力（音声も可）";
  const resultLabel =
    direction === "to_dialect" ? `${dialect}` : "標準語";

  return (
    <View style={[styles.screen, { backgroundColor: c.bg }]}>
      <StatusBar barStyle={scheme === "dark" ? "light-content" : "dark-content"} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* ヘッダー */}
        <View style={styles.header}>
          <Text style={[styles.title, { color: c.text }]}>TransHougen</Text>
          <Text style={[styles.subtitle, { color: c.subText }]}>
            方言⇄標準語 変換
          </Text>
        </View>

        {/* 方向セグメント */}
        <View style={[styles.segment, { backgroundColor: c.segBg }]}>
          <SegmentButton
            label="方言 → 標準語"
            active={direction === "to_standard"}
            onPress={() => setDirection("to_standard")}
            c={c}
          />
          <SegmentButton
            label="標準語 → 方言"
            active={direction === "to_dialect"}
            onPress={() => setDirection("to_dialect")}
            c={c}
          />
        </View>

        {direction === "to_dialect" ? (
          <>
            {/* 方言チップ：主要 */}
            <Text style={[styles.sectionLabel, { color: c.subText }]}>
              変換先（主要）
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {MAIN_DIALECTS.map((d) => (
                <DialectChip
                  key={d}
                  label={d}
                  selected={d === dialect}
                  onPress={() => setDialect(d)}
                  c={c}
                />
              ))}
            </ScrollView>

            {/* 方言チップ：番外編 */}
            <Text
              style={[styles.sectionLabel, { color: c.subText, marginTop: 14 }]}
            >
              番外編
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              {BONUS_DIALECTS.map((d) => (
                <DialectChip
                  key={d}
                  label={d}
                  selected={d === dialect}
                  onPress={() => setDialect(d)}
                  c={c}
                  bonus
                />
              ))}
            </ScrollView>
          </>
        ) : (
          <>
            {/* 方言→標準語：地方ヒント（任意・おまかせ可） */}
            <Text style={[styles.sectionLabel, { color: c.subText }]}>
              地方（任意・選択したら精度が上がります）
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipRow}
            >
              <DialectChip
                label="おまかせ"
                selected={region === REGION_AUTO}
                onPress={() => setRegion(REGION_AUTO)}
                c={c}
              />
              {REGIONS.map((r) => (
                <DialectChip
                  key={r}
                  label={r}
                  selected={r === region}
                  onPress={() => setRegion(r)}
                  c={c}
                />
              ))}
            </ScrollView>
          </>
        )}

        {/* 入力カード */}
        <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardLabel, { color: c.subText }]}>{inputLabel}</Text>
            <Text style={[styles.counter, { color: input.length >= MAX_CHARS ? "#ef4444" : c.subText }]}>
              {input.length}/{MAX_CHARS}
            </Text>
          </View>
          <TextInput
            style={[styles.input, { color: c.text, backgroundColor: c.inputBg, borderColor: c.border }]}
            placeholder={inputLabel}
            placeholderTextColor={c.subText}
            value={input}
            onChangeText={setInput}
            editable={!loading}
            maxLength={MAX_CHARS}
            multiline
            textAlignVertical="top"
          />

          {/* 音声入力（方言→標準語のときのみ） */}
          {direction === "to_standard" && (
            <Pressable
              onPress={recording ? handleStopRecording : handleStartRecording}
              disabled={transcribing || loading}
              style={({ pressed }) => [
                styles.micBtn,
                {
                  backgroundColor: recording ? "#ef4444" : c.chipBg,
                  borderColor: recording ? "#ef4444" : c.border,
                  opacity: transcribing || loading ? 0.5 : pressed ? 0.85 : 1,
                },
              ]}
            >
              {transcribing ? (
                <>
                  <ActivityIndicator color={c.subText} size="small" />
                  <Text style={{ color: c.subText, fontSize: 14, fontWeight: "600" }}>
                    文字起こし中…
                  </Text>
                </>
              ) : (
                <Text
                  style={{
                    color: recording ? "#ffffff" : c.chipText,
                    fontSize: 14,
                    fontWeight: "600",
                  }}
                >
                  {recording ? "■ 録音停止して文字起こし" : "🎤 音声で入力"}
                </Text>
              )}
            </Pressable>
          )}

          {(input.length > 0 || converted || error) && (
            <Pressable
              onPress={handleClear}
              style={({ pressed }) => [
                styles.clearBtn,
                {
                  borderColor: c.border,
                  backgroundColor: c.chipBg,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
              hitSlop={8}
            >
              <Text style={{ color: c.chipText, fontSize: 13, fontWeight: "600" }}>
                クリア
              </Text>
            </Pressable>
          )}
        </View>

        {/* 変換ボタン */}
        <Pressable
          onPress={handleConvert}
          disabled={loading || !input.trim()}
          style={({ pressed }) => [
            styles.convertBtn,
            {
              backgroundColor: c.accent,
              opacity: loading || !input.trim() ? 0.5 : pressed ? 0.85 : 1,
            },
          ]}
        >
          {loading ? (
            <ActivityIndicator color={c.accentText} />
          ) : (
            <Text style={[styles.convertBtnText, { color: c.accentText }]}>変換する</Text>
          )}
        </Pressable>

        {/* 方向入れ替え */}
        <Pressable onPress={handleSwap} style={styles.swapBtn} hitSlop={8}>
          <Text style={{ color: c.accent, fontSize: 14, fontWeight: "600" }}>
            ⇅ 方向を入れ替え
          </Text>
        </Pressable>

        {/* 結果カード */}
        {(converted || error) && (
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardLabel, { color: c.subText }]}>
                {error ? "エラー" : resultLabel}
              </Text>
              {!!converted && (
                <Pressable onPress={handleCopy} hitSlop={8}>
                  <Text style={{ color: c.accent, fontSize: 13, fontWeight: "600" }}>
                    {copied ? "✓ コピー済み" : "コピー"}
                  </Text>
                </Pressable>
              )}
            </View>
            <Text
              style={{
                color: error ? "#ef4444" : c.text,
                fontSize: 18,
                lineHeight: 26,
              }}
            >
              {error || converted}
            </Text>
          </View>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function SegmentButton({
  label,
  active,
  onPress,
  c,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  c: typeof palette.light;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.segBtn,
        // 選択中は地方チップと同じアクセントカラーで塗ってはっきり示す
        active && { backgroundColor: c.accent, ...shadow },
      ]}
    >
      <Text
        style={{
          color: active ? c.accentText : c.subText,
          fontWeight: active ? "700" : "500",
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function DialectChip({
  label,
  selected,
  onPress,
  c,
  bonus,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  c: typeof palette.light;
  bonus?: boolean;
}) {
  // 番外編は遊び枠としてアクセントを変える（ピンク系）
  const activeColor = bonus ? "#db2777" : c.accent;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? activeColor : c.chipBg,
          borderColor: selected ? activeColor : c.border,
        },
      ]}
    >
      <Text
        style={{
          color: selected ? "#ffffff" : c.chipText,
          fontWeight: selected ? "700" : "500",
          fontSize: 14,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const shadow =
  Platform.OS === "web"
    ? { boxShadow: "0 1px 3px rgba(0,0,0,0.12)" }
    : {
        shadowColor: "#000",
        shadowOffset: { width: 0, height: 1 },
        shadowOpacity: 0.12,
        shadowRadius: 3,
        elevation: 2,
      };

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: Platform.OS === "web" ? 24 : 56 },
  scrollContent: {
    paddingHorizontal: 20,
    maxWidth: 600,
    width: "100%",
    alignSelf: "center",
  },
  header: { alignItems: "center", marginBottom: 20 },
  title: { fontSize: 28, fontWeight: "800", letterSpacing: 0.5 },
  subtitle: { fontSize: 14, marginTop: 4 },
  segment: {
    flexDirection: "row",
    borderRadius: 12,
    padding: 4,
    marginBottom: 20,
  },
  segBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 9,
    alignItems: "center",
  },
  sectionLabel: { fontSize: 13, fontWeight: "600", marginBottom: 10 },
  chipRow: { gap: 8, paddingBottom: 4, paddingRight: 4 },
  chip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
  },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    marginTop: 16,
    ...shadow,
  },
  cardHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 10,
  },
  cardLabel: { fontSize: 13, fontWeight: "600" },
  counter: { fontSize: 12 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    fontSize: 17,
    lineHeight: 24,
  },
  micBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: 12,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
  },
  clearBtn: {
    alignSelf: "flex-end",
    marginTop: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  convertBtn: {
    marginTop: 20,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    ...shadow,
  },
  convertBtnText: { fontSize: 17, fontWeight: "700" },
  swapBtn: { alignSelf: "center", marginTop: 14, padding: 6 },
});
