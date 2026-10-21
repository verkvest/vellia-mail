import { Stack } from 'expo-router';
import { theme } from '../../theme';

export default function SettingsLayout() {
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: theme.bg } }} />;
}
