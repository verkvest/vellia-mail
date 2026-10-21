import { useRouter } from 'expo-router';
import { FlatList, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Banner, BottomBar, Chip, MessageRow, TopBar } from '../components/chrome';
import type { MailMessage } from '../mail/types';
import { formatWhen, type BoxFilter } from '../mail/view';
import { useMail } from '../state/MailContext';
import { theme } from '../theme';

export default function InboxScreen() {
  const mail = useMail();
  const router = useRouter();
  const title = boxTitle(mail.box, mail);
  const real = mail.state.accounts.some((account) => account.kind !== 'demo');
  return (
    <View style={styles.screen}>
      <TopBar
        kicker={mail.t('brand')}
        title={title}
        subtitle={mail.syncing ? mail.t('syncing') : mail.t('hotelLine')}
        action={mail.t('refresh')}
        onAction={() => void mail.refresh()}
      />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
        <Chip label={mail.t('allAccounts')} selected={mail.box.kind === 'inbox'} onPress={() => mail.setBox({ kind: 'inbox' })} />
        <Chip label={mail.t('unread')} selected={mail.box.kind === 'unread'} onPress={() => mail.setBox({ kind: 'unread' })} />
        <Chip label={mail.t('flagged')} selected={mail.box.kind === 'flagged'} onPress={() => mail.setBox({ kind: 'flagged' })} />
        {mail.state.accounts.map((account) => (
          <Chip
            key={account.id}
            label={account.email}
            color={account.color}
            selected={mail.box.kind === 'folder' && mail.box.accountId === account.id && mail.box.folder.toUpperCase() === 'INBOX'}
            onPress={() => mail.setBox({ kind: 'folder', accountId: account.id, folder: 'INBOX' })}
          />
        ))}
      </ScrollView>
      {Platform.OS === 'web' ? <Banner text={mail.t('webBanner')} /> : null}
      {!real ? <Banner text={mail.t('demoBanner')} /> : null}
      {mail.banner ? <Banner text={mail.banner} onClose={mail.clearBanner} /> : null}
      <FlatList
        style={{ flex: 1 }}
        data={mail.messages}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={mail.syncing} onRefresh={() => void mail.refresh()} tintColor={theme.accent} />}
        contentContainerStyle={mail.messages.length === 0 ? styles.emptyWrap : styles.list}
        ListEmptyComponent={<Text style={styles.empty}>{mail.t('emptyInbox')}</Text>}
        renderItem={({ item }) => <Row item={item} />}
      />
      <Pressable style={styles.compose} onPress={() => router.push({ pathname: '/compose', params: { mode: 'new' } })} accessibilityRole="button">
        <Text style={styles.composeText}>{mail.t('compose')}</Text>
      </Pressable>
      <BottomBar />
    </View>
  );
}

function Row({ item }: { item: MailMessage }) {
  const mail = useMail();
  const router = useRouter();
  const account = mail.state.accounts.find((entry) => entry.id === item.accountId);
  const label = mail.state.labels.find((entry) => item.labelIds.includes(entry.id));
  return (
    <MessageRow
      from={item.from.name || item.from.email}
      subject={item.subject || mail.t('noSubject')}
      snippet={item.snippet}
      time={formatWhen(item.date, mail.locale)}
      account={account?.email ?? ''}
      label={label?.name}
      unread={item.unread}
      flagged={item.flagged}
      attachment={item.hasAttachments}
      bar={item.color || account?.color || theme.accent}
      onPress={() => {
        if (item.unread) void mail.markRead(item.id, true);
        router.push({ pathname: '/message', params: { id: item.id } });
      }}
    />
  );
}

function boxTitle(box: BoxFilter, mail: ReturnType<typeof useMail>): string {
  if (box.kind === 'inbox') return mail.t('inbox');
  if (box.kind === 'unread') return mail.t('unread');
  if (box.kind === 'flagged') return mail.t('flagged');
  if (box.kind === 'label') return mail.state.labels.find((label) => label.id === box.id)?.name ?? mail.t('folders');
  if (box.folder.toUpperCase() === 'INBOX') return mail.t('inboxFolder');
  if (box.folder.toUpperCase() === 'SENT') return mail.t('sentFolder');
  return box.folder;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.bg },
  chips: { paddingHorizontal: 16, paddingBottom: 10, gap: 8 },
  list: { paddingTop: 4, paddingBottom: 12 },
  emptyWrap: { flexGrow: 1, justifyContent: 'center' },
  empty: { textAlign: 'center', color: theme.muted, fontSize: 16, marginHorizontal: 32 },
  compose: { marginHorizontal: 16, marginBottom: 10, backgroundColor: theme.accent, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  composeText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
