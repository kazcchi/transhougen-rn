import React, { useState } from 'react';
import { StyleSheet, TextInput, Button, ScrollView, View, Text, ActivityIndicator, Platform, useColorScheme } from 'react-native';

const VStack: React.FC<{ children: React.ReactNode; style?: any }> = ({ children, style }) => (
  <View style={[{ flexDirection: 'column', alignItems: 'stretch' }, style]}>{children}</View>
);

export default function App() {
  const colorScheme = useColorScheme();
  const [input, setInput] = useState('');
  const [converted, setConverted] = useState('');
  const [loading, setLoading] = useState(false);

  const handleConvert = async () => {
    setLoading(true);
    setConverted('');
    try {
      const response = await fetch('https://your-api-endpoint/convert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: input }),
      });
      const data = await response.json();
      setConverted(data.convertedText || '');
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
        <Text style={[styles.title, { color: isDark ? '#fff' : '#222' }]}>TransHougen</Text>
        <TextInput
          style={[styles.input, { backgroundColor: isDark ? '#222' : '#eee', color: isDark ? '#fff' : '#222' }]}
          placeholder="方言を入力"
          placeholderTextColor={isDark ? '#aaa' : '#888'}
          value={input}
          onChangeText={setInput}
          editable={!loading}
        />
        <Button title="変換" onPress={handleConvert} disabled={loading || !input.trim()} />
        {loading && <ActivityIndicator style={{ margin: 16 }} size="large" color={isDark ? '#fff' : '#222'} />}
        <ScrollView style={styles.scrollView} contentContainerStyle={{ padding: 12 }}>
          <Text style={{ color: isDark ? '#fff' : '#222', fontSize: 18 }}>{converted}</Text>
        </ScrollView>
      </VStack>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  vStack: {
    width: '100%',
    maxWidth: 600,
    gap: 16,
    ...(Platform.OS === 'web' ? { minHeight: '60vh' } : {}),
  },
  title: {
    fontSize: 32,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
  },
  input: {
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    marginBottom: 8,
  },
  scrollView: {
    marginTop: 18,
    backgroundColor: '#0000',
    minHeight: 80,
    maxHeight: 240,
    borderRadius: 8,
  },
});
