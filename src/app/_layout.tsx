import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useMail, MailProvider } from '../state/MailContext';
import { theme } from '../theme';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <MailProvider>
        <StatusBar style="dark" />
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
          <View style={{ flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center' }}>
            <Ready>
              <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }}>
                <Stack.Screen name="compose" options={{ presentation: 'modal' }} />
              </Stack>
            </Ready>
          </View>
        </View>
      </MailProvider>
    </SafeAreaProvider>
  );
}

function Ready({ children }: { children: ReactNode }) {
  const mail = useMail();
  if (!mail.ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.bg }}>
        <Text style={{ color: theme.muted, fontSize: 16 }}>{mail.t('loading')}</Text>
      </View>
    );
  }
  return children;
}
