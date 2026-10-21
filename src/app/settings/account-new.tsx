import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform, ScrollView, Switch, Text, View } from 'react-native';
import { GmailConnect } from '../../components/GmailConnect';
import { Button, Field, NavBar } from '../../components/chrome';
import { presetFor, type ServerPreset } from '../../mail/presets';
import { publicError } from '../../mail/redact';
import type { ImapDraft } from '../../sync/engine';
import { useMail } from '../../state/MailContext';
import { theme } from '../../theme';

type ProviderId = ServerPreset['id'] | 'gmail';

export default function AddAccountScreen() {
  const mail = useMail();
  const router = useRouter();
  const [provider, setProvider] = useState<ProviderId | null>(null);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavBar title={mail.t('addAccount')} onBack={() => provider ? setProvider(null) : router.back()} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        {!provider ? (
          <View style={{ marginTop: 8 }}>
            <Text style={hint}>{mail.t('accountsHelp')}</Text>
            <Button label={mail.t('gmail')} onPress={() => setProvider('gmail')} />
            <Button label={mail.t('mailru')} tone="quiet" onPress={() => setProvider('mailru')} />
            <Button label={mail.t('listru')} tone="quiet" onPress={() => setProvider('listru')} />
            <Button label={mail.t('gmailPassword')} tone="quiet" onPress={() => setProvider('gmail-imap')} />
            <Button label={mail.t('otherImap')} tone="quiet" onPress={() => setProvider('custom')} />
          </View>
        ) : null}
        {provider === 'gmail' ? <GmailConnect onPassword={() => setProvider('gmail-imap')} /> : null}
        {provider && provider !== 'gmail' ? <ImapForm key={provider} provider={provider} onDone={() => router.back()} /> : null}
      </ScrollView>
    </View>
  );
}

function ImapForm({ provider, onDone }: { provider: ServerPreset['id']; onDone: () => void }) {
  const mail = useMail();
  const preset = presetFor(provider);
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [advanced, setAdvanced] = useState(provider === 'custom');
  const [imapHost, setImapHost] = useState(preset.imapHost);
  const [imapPort, setImapPort] = useState(String(preset.imapPort));
  const [imapTls, setImapTls] = useState(preset.imapTls);
  const [smtpHost, setSmtpHost] = useState(preset.smtpHost);
  const [smtpPort, setSmtpPort] = useState(String(preset.smtpPort));
  const [smtpTls, setSmtpTls] = useState(preset.smtpTls);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  function draft(): ImapDraft | string {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return mail.t('invalidEmail');
    const imap = Number(imapPort);
    const smtp = Number(smtpPort);
    if (!Number.isInteger(imap) || !Number.isInteger(smtp) || imap < 1 || smtp < 1 || imap > 65535 || smtp > 65535) return mail.t('invalidPort');
    if (!password.trim() || !imapHost.trim() || !smtpHost.trim()) return mail.t('required');
    return {
      email: email.trim(),
      displayName: displayName.trim(),
      password,
      username: username.trim(),
      imapHost: imapHost.trim(),
      imapPort: imap,
      imapTls,
      smtpHost: smtpHost.trim(),
      smtpPort: smtp,
      smtpTls,
    };
  }

  async function run(save: boolean) {
    const next = draft();
    if (typeof next === 'string') {
      setError(next);
      setNote('');
      return;
    }
    setBusy(true);
    setError('');
    setNote('');
    try {
      await mail.probe(next);
      if (save) {
        await mail.saveImap(next);
        void mail.refresh();
        onDone();
        return;
      }
      setNote(mail.t('connectionOk'));
    } catch (caught) {
      setError(publicError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Text style={hint}>{mail.t('appPasswordHint')}</Text>
      <Field label={mail.t('email')} value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Field label={mail.t('displayName')} value={displayName} onChangeText={setDisplayName} />
      <Field label={mail.t('appPassword')} value={password} onChangeText={setPassword} secureTextEntry autoCapitalize="none" hint={Platform.OS === 'web' ? mail.t('webPasswordNote') : mail.t('keychainNote')} />
      <Field label={mail.t('username')} value={username} onChangeText={setUsername} autoCapitalize="none" hint={mail.t('usernameHint')} />
      {provider !== 'custom' ? (
        <Button label={advanced ? mail.t('hideAdvanced') : mail.t('showAdvanced')} tone="quiet" onPress={() => setAdvanced((value) => !value)} />
      ) : null}
      {advanced ? (
        <View>
          <Field label={mail.t('hostImap')} value={imapHost} onChangeText={setImapHost} autoCapitalize="none" />
          <Field label={mail.t('port')} value={imapPort} onChangeText={setImapPort} keyboardType="number-pad" />
          <Toggle label={`${mail.t('tls')} IMAP`} value={imapTls} onChange={setImapTls} />
          <Field label={mail.t('hostSmtp')} value={smtpHost} onChangeText={setSmtpHost} autoCapitalize="none" />
          <Field label={mail.t('port')} value={smtpPort} onChangeText={setSmtpPort} keyboardType="number-pad" />
          <Toggle label={`${mail.t('tls')} SMTP`} value={smtpTls} onChange={setSmtpTls} />
        </View>
      ) : null}
      {note ? <Text style={ok}>{note}</Text> : null}
      {error ? <Text style={bad}>{error}</Text> : null}
      <Button label={busy ? mail.t('checking') : mail.t('testConnection')} tone="quiet" disabled={busy} onPress={() => void run(false)} />
      <Button label={busy ? mail.t('working') : mail.t('save')} disabled={busy} onPress={() => void run(true)} />
    </View>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={{ marginHorizontal: 20, marginTop: 14, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
      <Text style={{ color: theme.ink, fontSize: 16 }}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ true: theme.accent, false: theme.line }} />
    </View>
  );
}

const hint = { color: theme.muted, fontSize: 14, lineHeight: 20, marginHorizontal: 20, marginTop: 12 };
const ok = { color: theme.good, marginHorizontal: 20, marginTop: 12, lineHeight: 20 };
const bad = { color: theme.danger, marginHorizontal: 20, marginTop: 12, lineHeight: 20 };
