import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Chip, NavBar, Swatches, one } from '../components/chrome';
import { addressLine } from '../mail/types';
import { formatFull } from '../mail/view';
import { useMail } from '../state/MailContext';
import { theme } from '../theme';

export default function MessageScreen() {
  const mail = useMail();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const id = one(useLocalSearchParams<{ id?: string }>().id);
  const message = mail.state.messages.find((item) => item.id === id);
  if (!message) {
    return (
      <View style={styles.screen}>
        <NavBar title={mail.t('missingMessage')} onBack={() => router.back()} />
        <Text style={styles.missing}>{mail.t('missingMessage')}</Text>
      </View>
    );
  }
  const account = mail.state.accounts.find((item) => item.id === message.accountId);
  return (
    <View style={styles.screen}>
      <NavBar title={account?.email ?? mail.t('appName')} subtitle={formatFull(message.date, mail.locale)} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.subject}>{message.subject || mail.t('noSubject')}</Text>
        <Text style={styles.meta}>{mail.t('from')}: {message.from.name ? `${message.from.name} <${message.from.email}>` : message.from.email}</Text>
        <Text style={styles.meta}>{mail.t('to')}: {addressLine(message.to) || '—'}</Text>
        {message.cc.length ? <Text style={styles.meta}>{mail.t('cc')}: {addressLine(message.cc)}</Text> : null}
        <Text style={styles.letter}>{message.text.trim() || mail.t('noBody')}</Text>
        {message.attachments.length ? (
          <View style={styles.files}>
            <Text style={styles.filesTitle}>{mail.t('attachments')}</Text>
            <Text style={styles.note}>{mail.t('attachmentNote')}</Text>
            {message.attachments.map((file) => (
              <View key={file.id} style={styles.file}>
                <Text style={styles.fileName}>{file.filename}</Text>
                <Text style={styles.note}>{formatSize(file.size)}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {mail.state.labels.length ? (
          <View style={styles.labels}>
            {mail.state.labels.map((label) => (
              <Chip key={label.id} label={label.name} color={label.color} selected={message.labelIds.includes(label.id)} onPress={() => void mail.toggleLabel(message.id, label.id)} />
            ))}
          </View>
        ) : null}
        <Text style={styles.colorLabel}>{mail.t('colorLabel')}</Text>
        <Swatches value={message.color} onChange={(color) => void mail.setColor(message.id, color)} />
      </ScrollView>
      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 10) }]}>
        <Action label={mail.t('reply')} onPress={() => open('reply')} />
        <Action label={mail.t('replyAll')} onPress={() => open('replyAll')} />
        <Action label={mail.t('forward')} onPress={() => open('forward')} />
        <Action label={message.flagged ? mail.t('unflagAction') : mail.t('flagAction')} onPress={() => void mail.setFlag(message.id, !message.flagged)} />
        <Action label={message.unread ? mail.t('markReadAction') : mail.t('markUnread')} onPress={() => void mail.markRead(message.id, message.unread)} />
      </View>
    </View>
  );

  function open(mode: 'reply' | 'replyAll' | 'forward') {
    router.push({ pathname: '/compose', params: { mode, messageId: message?.id ?? '' } });
  }
}

function Action({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Text onPress={onPress} style={styles.action} accessibilityRole="button">{label}</Text>
  );
}

function formatSize(size: number): string {
  if (!size) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  missing: { textAlign: 'center', color: theme.muted, marginTop: 40 },
  body: { paddingHorizontal: 20, paddingBottom: 24 },
  subject: { fontSize: 24, fontWeight: '700', color: theme.ink, marginBottom: 10 },
  meta: { color: theme.muted, fontSize: 14, lineHeight: 20 },
  letter: { marginTop: 18, fontSize: 17, lineHeight: 25, color: theme.ink },
  files: { marginTop: 20, gap: 8 },
  filesTitle: { fontWeight: '700', color: theme.ink },
  note: { color: theme.muted, fontSize: 13 },
  file: { backgroundColor: theme.paper, borderRadius: 12, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
  fileName: { color: theme.ink, fontSize: 15 },
  labels: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 20 },
  colorLabel: { marginTop: 18, marginBottom: 8, color: theme.muted, fontWeight: '600' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, backgroundColor: theme.paper },
  action: { color: theme.accentDark, fontWeight: '700', fontSize: 15, paddingHorizontal: 8, paddingVertical: 8 },
});
