import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Platform, ScrollView, Switch, Text, View } from 'react-native';
import { notificationPermission, previewNotification, registerBackgroundSync } from '../../background/task';
import { Button, Field, Hint, NavBar } from '../../components/chrome';
import { publicError } from '../../mail/redact';
import { formatFull } from '../../mail/view';
import { useMail } from '../../state/MailContext';
import { theme } from '../../theme';

export default function NotificationsScreen() {
  const mail = useMail();
  const router = useRouter();
  const [url, setUrl] = useState(mail.state.settings.relayUrl);
  const [secret, setSecret] = useState('');
  const [status, setStatus] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void registerBackgroundSync().then(setStatus).catch(() => setStatus('unknown'));
  }, []);

  const statusText = status === 'available' ? mail.t('statusAvailable') : status === 'restricted' ? mail.t('statusRestricted') : status ? mail.t('statusUnknown') : mail.t('working');
  const synced = mail.state.settings.lastSyncAt ? formatFull(mail.state.settings.lastSyncAt, mail.locale) : mail.t('neverSynced');

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavBar title={mail.t('notifications')} onBack={() => router.back()} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 36 }}>
        {Platform.OS === 'web' ? <Hint>{mail.t('webBanner')}</Hint> : null}
        <Hint>{mail.t('notificationsLead')}</Hint>
        <View style={row}>
          <Text style={{ color: theme.ink, fontSize: 16, flex: 1 }}>{mail.t('backgroundToggle')}</Text>
          <Switch
            value={mail.state.settings.backgroundSyncEnabled}
            onValueChange={(enabled) => {
              void (async () => {
                if (enabled) await notificationPermission().catch(() => undefined);
                await mail.setBackground(enabled);
              })();
            }}
            trackColor={{ true: theme.accent, false: theme.line }}
          />
        </View>
        <Hint>{statusText}</Hint>
        <Hint>{`${mail.t('lastSync')}: ${synced}`}</Hint>
        {mail.state.settings.lastSyncError ? <Hint>{mail.state.settings.lastSyncError}</Hint> : null}
        <Button
          label={mail.t('testNotification')}
          tone="quiet"
          onPress={() => {
            void previewNotification(mail.t('testNotificationBody')).then(() => setNote(mail.t('saved'))).catch((caught) => setError(publicError(caught)));
          }}
        />
        <Field label={mail.t('relayUrl')} value={url} onChangeText={setUrl} autoCapitalize="none" placeholder="https://mail.example.com" hint={mail.t('relayHint')} />
        <Field label={mail.t('relaySecret')} value={secret} onChangeText={setSecret} secureTextEntry autoCapitalize="none" hint={mail.t('passwordKept')} />
        {note ? <Text style={{ color: theme.good, marginHorizontal: 20, marginTop: 12 }}>{note}</Text> : null}
        {error ? <Text style={{ color: theme.danger, marginHorizontal: 20, marginTop: 12 }}>{error}</Text> : null}
        <Button
          label={mail.t('save')}
          onPress={() => {
            setError('');
            void mail.saveRelay(url, secret).then(() => {
              setSecret('');
              setNote(mail.t('relaySaved'));
            }).catch((caught) => setError(publicError(caught)));
          }}
        />
      </ScrollView>
    </View>
  );
}

const row = { marginHorizontal: 20, marginTop: 18, flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12 };
