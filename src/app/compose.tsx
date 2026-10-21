import * as DocumentPicker from 'expo-document-picker';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Button, Chip, Field, NavBar, one } from '../components/chrome';
import { parseAddressList } from '../mail/header';
import { quoteBody, referenceHeader, replyRecipients, replySubject } from '../mail/quote';
import { firstName, placeSignature, renderTemplate } from '../mail/templates';
import type { OutgoingMail } from '../mail/types';
import { publicError } from '../mail/redact';
import { useMail } from '../state/MailContext';
import { theme } from '../theme';

interface DraftFile {
  filename: string;
  contentType: string;
  contentBase64: string;
  size: number;
}

const MAX_BYTES = 20 * 1024 * 1024;

export default function ComposeScreen() {
  const mail = useMail();
  const router = useRouter();
  const params = useLocalSearchParams<{ mode?: string; messageId?: string }>();
  const mode = one(params.mode);
  const messageId = one(params.messageId);
  const realAccounts = mail.state.accounts.filter((account) => account.kind !== 'demo');
  const choices = realAccounts.length ? realAccounts : mail.state.accounts;
  const [accountId, setAccountId] = useState(choices[0]?.id ?? '');
  const [to, setTo] = useState('');
  const [cc, setCc] = useState('');
  const [bcc, setBcc] = useState('');
  const [showCc, setShowCc] = useState(false);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [files, setFiles] = useState<DraftFile[]>([]);
  const [useSignature, setUseSignature] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const source = useMemo(() => mail.state.messages.find((item) => item.id === messageId), [mail.state.messages, messageId]);
  const seeded = useRef(false);

  useEffect(() => {
    if (seeded.current || !mode) return;
    const pool = mail.state.accounts.filter((item) => item.kind !== 'demo');
    const fallback = (pool.length ? pool : mail.state.accounts)[0];
    const account = mail.state.accounts.find((item) => item.id === (source?.accountId ?? fallback?.id));
    const picked = account && (pool.length === 0 || account.kind !== 'demo') ? account : fallback;
    if (mode === 'new') {
      seeded.current = true;
      if (picked) setAccountId(picked.id);
      setUseSignature(Boolean(picked && mail.state.signatures[picked.id]?.enabled));
      return;
    }
    if ((mode !== 'reply' && mode !== 'replyAll' && mode !== 'forward') || !source || !picked) return;
    seeded.current = true;
    setAccountId(picked.id);
    setUseSignature(Boolean(mail.state.signatures[picked.id]?.enabled));
    const people = replyRecipients(source, picked.email, mode === 'replyAll' ? 'replyAll' : mode === 'forward' ? 'forward' : 'reply');
    setTo(showAddresses(people.to));
    setCc(showAddresses(people.cc));
    setShowCc(people.cc.length > 0);
    setSubject(replySubject(source.subject, mode === 'forward' ? 'forward' : 'reply'));
    const who = source.from.name || source.from.email;
    setBody(quoteBody(source.text, `${who} ${mail.t('wrote')}`));
  }, [mode, source, messageId, mail.state.accounts, mail.state.signatures]);

  const account = mail.state.accounts.find((item) => item.id === accountId);
  const title = mode === 'forward' ? mail.t('forwardTitle') : mode === 'reply' || mode === 'replyAll' ? mail.t('replyTitle') : mail.t('composeNew');

  async function attach() {
    const picked = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, base64: true });
    if (picked.canceled) return;
    const next: DraftFile[] = [];
    for (const asset of picked.assets) {
      const contentBase64 = plainBase64(asset.base64 ?? await readFile(asset.uri));
      next.push({
        filename: asset.name.replace(/[\r\n"]/g, '') || 'file',
        contentType: asset.mimeType || 'application/octet-stream',
        contentBase64,
        size: asset.size ?? Math.floor(contentBase64.length * 0.75),
      });
    }
    const total = [...files, ...next].reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_BYTES) {
      setError(mail.t('tooLarge'));
      return;
    }
    setFiles((current) => [...current, ...next]);
    setError('');
  }

  function applyTemplate(templateId: string) {
    const template = mail.state.templates.find((item) => item.id === templateId);
    if (!template || !account) return;
    const recipient = parseAddressList(to)[0];
    const rendered = renderTemplate(template.body, {
      name: firstName(recipient?.name, recipient?.email),
      email: recipient?.email,
      subject,
      myEmail: account.email,
      account: account.displayName,
      locale: mail.locale,
    });
    setBody((current) => insertBeforeQuote(current, rendered));
  }

  async function send() {
    if (!account) {
      setError(mail.t('needRealAccount'));
      return;
    }
    const toList = parseAddressList(to);
    if (!toList.length) {
      setError(mail.t('needRecipient'));
      return;
    }
    if (account.kind === 'demo') {
      setError(mail.t('needRealAccount'));
      return;
    }
    const signature = mail.state.signatures[account.id];
    const text = placeSignature(body, signature?.body, useSignature);
    const mailOut: OutgoingMail = {
      from: { name: account.displayName, email: account.email },
      to: toList,
      cc: showCc ? parseAddressList(cc) : [],
      bcc: showCc ? parseAddressList(bcc) : [],
      subject: subject.trim(),
      text,
      attachments: files.map(({ filename, contentType, contentBase64 }) => ({ filename, contentType, contentBase64 })),
      inReplyTo: mode === 'forward' ? undefined : source?.messageId,
      references: mode === 'forward' ? undefined : referenceHeader(source?.references, source?.messageId),
    };
    setBusy(true);
    setError('');
    try {
      await mail.send(account.id, mailOut);
      if (Platform.OS !== 'web') await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(mail.t('sentOk'), mail.t('draftSavedLocal'));
      router.back();
    } catch (caught) {
      setError(publicError(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.screen}>
      <NavBar title={title} onBack={() => router.back()} right={busy ? mail.t('sending') : mail.t('send')} onRight={() => { if (!busy) void send(); }} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 40 }}>
        <Text style={styles.label}>{mail.t('chooseAccount')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          {choices.map((item) => (
            <Chip key={item.id} label={item.email} color={item.color} selected={item.id === accountId} onPress={() => {
              setAccountId(item.id);
              setUseSignature(mail.state.signatures[item.id]?.enabled ?? false);
            }} />
          ))}
        </ScrollView>
        <Field label={mail.t('to')} value={to} onChangeText={setTo} autoCapitalize="none" keyboardType="email-address" />
        <Button label={showCc ? mail.t('hideCc') : mail.t('showCc')} tone="quiet" onPress={() => setShowCc((value) => !value)} />
        {showCc ? (
          <>
            <Field label={mail.t('cc')} value={cc} onChangeText={setCc} autoCapitalize="none" />
            <Field label={mail.t('bcc')} value={bcc} onChangeText={setBcc} autoCapitalize="none" />
          </>
        ) : null}
        <Field label={mail.t('subject')} value={subject} onChangeText={setSubject} placeholder={mail.t('noSubject')} />
        {mail.state.templates.length ? (
          <>
            <Text style={styles.label}>{mail.t('pickTemplate')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {mail.state.templates.map((template) => (
                <Chip key={template.id} label={template.title} onPress={() => applyTemplate(template.id)} />
              ))}
            </ScrollView>
            <Text style={styles.help}>{mail.t('placeholderHelp')}</Text>
          </>
        ) : null}
        <Field label={mail.t('templateBody')} value={body} onChangeText={setBody} multiline placeholder={mail.t('bodyPlaceholder')} />
        <View style={styles.signRow}>
          <Text style={styles.signLabel}>{useSignature ? mail.t('signatureOn') : mail.t('signatureOff')}</Text>
          <Switch value={useSignature} onValueChange={setUseSignature} trackColor={{ true: theme.accent, false: theme.line }} />
        </View>
        {files.map((file, index) => (
          <Text key={`${file.filename}-${index}`} style={styles.file} onPress={() => setFiles((current) => current.filter((_, item) => item !== index))}>
            {file.filename} · {mail.t('remove')}
          </Text>
        ))}
        <Button label={mail.t('attach')} tone="quiet" onPress={() => void attach().catch((caught) => setError(publicError(caught)))} />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label={busy ? mail.t('sending') : mail.t('send')} disabled={busy} onPress={() => void send()} />
      </ScrollView>
    </View>
  );
}

function showAddresses(addresses: { name: string; email: string }[]): string {
  return addresses.map((item) => item.name.trim() ? `${item.name.trim()} <${item.email}>` : item.email).join(', ');
}

function insertBeforeQuote(current: string, rendered: string): string {
  const match = current.match(/\n\n[^\n]{1,160}:\n>/);
  if (!match || match.index === undefined) {
    return current.trim() ? `${current.replace(/\s+$/, '')}\n\n${rendered}` : rendered;
  }
  const head = current.slice(0, match.index).replace(/\s+$/, '');
  return `${head ? `${head}\n\n` : ''}${rendered}${current.slice(match.index)}`;
}

function plainBase64(value: string): string {
  const comma = value.indexOf(',');
  if (value.startsWith('data:') && comma !== -1) return value.slice(comma + 1);
  return value;
}

async function readFile(uri: string): Promise<string> {
  const { File } = await import('expo-file-system');
  return new File(uri).base64();
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  label: { marginHorizontal: 20, marginTop: 16, marginBottom: 8, color: theme.muted, fontWeight: '600' },
  chips: { paddingHorizontal: 16, gap: 8 },
  help: { color: theme.muted, fontSize: 13, lineHeight: 18, marginHorizontal: 20, marginTop: 8 },
  signRow: { marginHorizontal: 20, marginTop: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  signLabel: { color: theme.ink, fontSize: 16 },
  file: { marginHorizontal: 20, marginTop: 8, color: theme.sea },
  error: { color: theme.danger, marginHorizontal: 20, marginTop: 12, lineHeight: 20 },
});
