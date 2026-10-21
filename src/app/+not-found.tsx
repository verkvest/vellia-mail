import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Button } from '../components/chrome';
import { useMail } from '../state/MailContext';
import { theme } from '../theme';

export default function Missing() {
  const mail = useMail();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg, justifyContent: 'center' }}>
      <Text style={{ textAlign: 'center', color: theme.ink, fontSize: 18, marginBottom: 12 }}>{mail.t('missingMessage')}</Text>
      <Button label={mail.t('inbox')} onPress={() => router.replace('/')} />
    </View>
  );
}
