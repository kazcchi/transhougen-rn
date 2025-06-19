import React, { useState } from 'react';
import {
  StyleSheet,
  TextInput,
  Button,
  ScrollView,
  View,
  Text,
  ActivityIndicator,
  useColorScheme,
} from 'react-native';

const VStack: React.FC<{ children: React.ReactNode; style?: any }> = ({
  children,
  style,
}) => (
  <View style={[{ flexDirection: 'column', alignItems: 'stretch' }, style]}>
    {children}
  </View>
);

export default function App() {
  const colorScheme = useColorScheme();
  const [input, setInput] = useState('');
  const [converted, setConverted] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConvert = async () => {
    if (!input.trim()) return;
    setLoading(true);
    setConverted('');
    try {
      const response = await fetch(
        'https://us-central1-transhougen.cloudfunctions.net/dialectConverter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: input }),
        }
      );
      const data = await response.json();
      // ← ここを data.result に変更！
      setConverted(data.result ?? '（変換結果がありません）');
    } catch (e) {
      setConverted('エラーが発生しました');
    } finally {
      setLoading(false);
    }
  };

  const isDark = colorScheme === 'dark';

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#181818' : '#fff' }]}>
      <VStack style={styles.vStack}>
        <Text style={[styles.title, { color: isDark ? '#fff' : '#222' }]}>
          TransHougen
        </Text>
        <TextInput
          style={[styles.input, { backgroundColor: isDark ? '#222' : '#eee', color: isDark ? '#fff' : '#000' }]}
          placeholder="方言を入力"
          placeholderTextColor={isDark ? '#aaa' : '#888'}
          value={input}
          onChangeText={setInput}
          editable={!loading}
        />
        <Button title={loading ? '変換中…' : '変換する'} onPress={handleConvert} disabled={loading || !input.trim()} />
        {loading && <ActivityIndicator style={{ margin: 16 }} size="large" />}
        <ScrollView style={styles.scrollView} contentContainerStyle={{ padding: 12 }}>
          <Text style={{ color: isDark ? '#fff' : '#222', fontSize: 18 }}>
            {converted}
          </Text>
        </ScrollView>
      </VStack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  vStack: { flex: 1 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16 },
  input: {
    height: 44,
    borderColor: '#888',
    borderWidth: 1,
    paddingHorizontal: 12,
    marginBottom: 12,
    borderRadius: 6,
  },
  scrollView: {
    flex: 1,
    borderColor: '#ccc',
    borderWidth: 1,
    borderRadius: 6,
  },
});

