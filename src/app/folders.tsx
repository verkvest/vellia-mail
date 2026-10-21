import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { BottomBar, Button, Cell, Field, Group, Section, Swatches, TopBar } from '../components/chrome';
import { createId } from '../mail/types';
import { selectMessages } from '../mail/view';
import { useMail } from '../state/MailContext';
import { swatches, theme } from '../theme';

export default function FoldersScreen() {
  const mail = useMail();
  const router = useRouter();
  const [name, setName] = useState('');
  const [color, setColor] = useState(swatches[2] ?? '#2F5D50');
  const [error, setError] = useState('');

  function openLabel(id: string) {
    mail.setBox({ kind: 'label', id });
    router.push('/');
  }

  function openFolder(accountId: string, folder: string) {
    mail.setBox({ kind: 'folder', accountId, folder });
    router.push('/');
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar kicker={mail.t('brand')} title={mail.t('folders')} subtitle={mail.t('hotelLine')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
        <Section>{mail.t('localFolders')}</Section>
        <Group>
          <Cell title={mail.t('unread')} value={String(selectMessages(mail.state, { kind: 'unread' }).length)} onPress={() => { mail.setBox({ kind: 'unread' }); router.push('/'); }} />
          <Cell title={mail.t('flagged')} value={String(selectMessages(mail.state, { kind: 'flagged' }).length)} onPress={() => { mail.setBox({ kind: 'flagged' }); router.push('/'); }} last={mail.state.labels.length === 0} />
          {mail.state.labels.map((label, index) => (
            <Cell
              key={label.id}
              title={label.name}
              color={label.color}
              value={String(selectMessages(mail.state, { kind: 'label', id: label.id }).length)}
              onPress={() => openLabel(label.id)}
              last={index === mail.state.labels.length - 1}
            />
          ))}
        </Group>
        <HintLine text={mail.t('rulesHelp')} />
        <Field label={mail.t('labelName')} value={name} onChangeText={setName} />
        <View style={{ marginHorizontal: 20, marginTop: 12 }}>
          <Text style={{ color: theme.muted, marginBottom: 8 }}>{mail.t('colorLabel')}</Text>
          <Swatches value={color} onChange={(next) => setColor(next ?? color)} />
        </View>
        {error ? <Text style={{ color: theme.danger, marginHorizontal: 20, marginTop: 8 }}>{error}</Text> : null}
        <Button
          label={mail.t('addLabel')}
          onPress={() => {
            const trimmed = name.trim();
            if (!trimmed) {
              setError(mail.t('labelMissing'));
              return;
            }
            setError('');
            void mail.saveLabel({ id: createId('label'), name: trimmed, color });
            setName('');
          }}
        />
        {mail.state.labels.length ? (
          <Button
            label={mail.t('removeLabel')}
            tone="quiet"
            onPress={() => {
              Alert.alert(mail.t('removeLabel'), mail.state.labels.map((label) => label.name).join(', '), [
                { text: mail.t('cancel'), style: 'cancel' },
                ...mail.state.labels.map((label) => ({
                  text: label.name,
                  style: 'destructive' as const,
                  onPress: () => void mail.deleteLabel(label.id),
                })),
              ]);
            }}
          />
        ) : null}
        <Section>{mail.t('serverFolders')}</Section>
        {mail.state.accounts.map((account) => (
          <View key={account.id}>
            <Section>{account.email}</Section>
            <Group>
              {foldersFor(account.id, mail.state.messages).map((folder, index, list) => (
                <Cell
                  key={folder}
                  title={folderName(folder, mail.t)}
                  color={account.color}
                  value={String(selectMessages(mail.state, { kind: 'folder', accountId: account.id, folder }).length)}
                  onPress={() => openFolder(account.id, folder)}
                  last={index === list.length - 1}
                />
              ))}
            </Group>
          </View>
        ))}
      </ScrollView>
      <BottomBar />
    </View>
  );
}

function HintLine({ text }: { text: string }) {
  return <Text style={{ color: theme.muted, fontSize: 13, lineHeight: 18, marginHorizontal: 20, marginTop: 10 }}>{text}</Text>;
}

function folderName(folder: string, t: (key: 'inboxFolder' | 'sentFolder') => string): string {
  if (folder.toUpperCase() === 'INBOX') return t('inboxFolder');
  if (folder.toUpperCase() === 'SENT') return t('sentFolder');
  return folder;
}

function foldersFor(accountId: string, messages: { accountId: string; folder: string }[]): string[] {
  const found = new Set<string>(['INBOX']);
  for (const message of messages) {
    if (message.accountId === accountId && message.folder) found.add(message.folder);
  }
  const sent = [...found].find((folder) => folder.toUpperCase() === 'SENT');
  const rest = [...found].filter((folder) => folder.toUpperCase() !== 'INBOX' && folder.toUpperCase() !== 'SENT').sort((a, b) => a.localeCompare(b));
  return ['INBOX', ...(sent ? [sent] : []), ...rest];
}
