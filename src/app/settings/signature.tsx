import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { Button, Field, Hint, NavBar, one } from '../../components/chrome';
import { useMail } from '../../state/MailContext';
import { theme } from '../../theme';

export default function SignatureScreen() {
  const mail = useMail();
  const router = useRouter();
  const accountId = one(useLocalSearchParams<{ accountId?: string }>().accountId);
  const account = mail.state.accounts.find((item) => item.id === accountId);
  const current = account ? mail.state.signatures[account.id] : undefined;
  const [body, setBody] = useState(current?.body ?? '');
  const [enabled, setEnabled] = useState(current?.enabled ?? true);
  const [note, setNote] = useState('');
  if (!account) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <NavBar title={mail.t('signatures')} onBack={() => router.back()} />
        <Text style={{ textAlign: 'center', color: theme.muted, marginTop: 32 }}>{mail.t('nothingSelected')}</Text>
      </View>
    );
  }
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavBar title={mail.t('editSignature')} subtitle={account.email} onBack={() => router.back()} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <Hint>{mail.t('signatureHint')}</Hint>
        <View style={{ marginHorizontal: 20, marginTop: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Text style={{ color: theme.ink, fontSize: 16 }}>{enabled ? mail.t('signatureOn') : mail.t('signatureOff')}</Text>
          <Switch value={enabled} onValueChange={setEnabled} trackColor={{ true: theme.accent, false: theme.line }} />
        </View>
        <Field label={mail.t('templateBody')} value={body} onChangeText={setBody} multiline />
        {note ? <Text style={{ color: theme.good, marginHorizontal: 20, marginTop: 12 }}>{note}</Text> : null}
        <Button label={mail.t('save')} onPress={() => { void mail.saveSignature(account.id, { body, enabled }); setNote(mail.t('saved')); }} />
      </ScrollView>
    </View>
  );
}
