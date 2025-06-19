// App.tsx
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

const VStack: React.FC<{ children: React.ReactNode; style?: any }> = ({ children, style }) => (
  <View style={[{ flexDirection: 'column', alignItems: 'stretch' }, style]}>
    {children}
  </View>
);

export default function App() {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const [input, setInput] = useState('');
  const [converted, setConverted] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConvert = async () => {
    setLoading(true);
    setConverted('');
    try {
      const res = await fetch(
        'https://us-central1-transhougen.cloudfunctions.net/dialectConverter',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: input }),
        }
      );
      const json = await res.json();
      setConverted(json.result || '変換結果がありません');
    } catch (err) {
      setConverted('エラーが発生しました');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: isDark ? '#181818' : '#ffffff' }]}>
      <VStack style={styles.vStack}>
        <Text style={[styles.title, { color: isDark ? '#fff' : '#222' }]}>TransHougen</Text>

        <TextInput
          style={[
            styles.input,
            { backgroundColor: isDark ? '#222' : '#eee', color: isDark ? '#fff' : '#000' },
          ]}
          placeholder="変換したいテキストを入力"
          placeholderTextColor={isDark ? '#aaa' : '#888'}
          value={input}
          onChangeText={setInput}
          editable={!loading}
        />

        <Button
          title={loading ? '変換中…' : '変換'}
          onPress={handleConvert}
          disabled={loading || !input.trim()}
        />

        {loading && <ActivityIndicator style={{ marginTop: 16 }} size="large" />}

        <ScrollView style={styles.resultContainer} contentContainerStyle={{ padding: 12 }}>
          <Text style={{ color: isDark ? '#fff' : '#222', fontSize: 18 }}>{converted}</Text>
        </ScrollView>
      </VStack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  vStack: { flex: 1 },
  title: { fontSize: 24, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' },
  input: {
    height: 40,
    borderColor: '#888',
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 8,
    marginBottom: 12,
  },
  resultContainer: { flex: 1, marginTop: 16 },
});

