import { useLocalSearchParams, useRouter } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import { Button, Cell, Group, NavBar, one } from '../../../components/chrome';
import { useMail } from '../../../state/MailContext';
import { theme } from '../../../theme';

export default function AccountScreen() {
  const mail = useMail();
  const router = useRouter();
  const id = one(useLocalSearchParams<{ id?: string }>().id);
  const account = mail.state.accounts.find((item) => item.id === id);
  if (!account) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <NavBar title={mail.t('accounts')} onBack={() => router.back()} />
        <Text style={{ textAlign: 'center', marginTop: 40, color: theme.muted }}>{mail.t('nothingSelected')}</Text>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavBar title={account.displayName} subtitle={account.email} onBack={() => router.back()} />
      <ScrollView>
        <Group style={{ marginTop: 12 }}>
          <Cell title={mail.t('email')} value={account.email} />
          <Cell title={mail.t('provider')} value={account.kind === 'gmail' ? mail.t('gmailConnected') : account.kind === 'demo' ? 'demo' : 'IMAP'} />
          {account.imap ? <Cell title={mail.t('hostImap')} value={`${account.imap.imapHost}:${account.imap.imapPort}`} /> : null}
          {account.imap ? <Cell title={mail.t('hostSmtp')} value={`${account.imap.smtpHost}:${account.imap.smtpPort}`} /> : null}
          <Cell title={account.kind === 'gmail' ? mail.t('gmailConnected') : mail.t('passwordKept')} last />
        </Group>
        <Button label={mail.t('editSignature')} tone="quiet" onPress={() => router.push({ pathname: '/settings/signature', params: { accountId: account.id } })} />
        <Button
          label={mail.t('deleteAccount')}
          tone="danger"
          onPress={() => {
            Alert.alert(mail.t('deleteAccount'), mail.t('deleteAccountBody'), [
              { text: mail.t('cancel'), style: 'cancel' },
              {
                text: mail.t('confirmDelete'),
                style: 'destructive',
                onPress: () => {
                  void mail.deleteAccount(account.id);
                  router.back();
                },
              },
            ]);
          }}
        />
      </ScrollView>
    </View>
  );
}
