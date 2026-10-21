import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { BottomBar, Button, Field, MessageRow, TopBar } from '../components/chrome';
import { formatWhen, searchMessages } from '../mail/view';
import { useMail } from '../state/MailContext';
import { theme } from '../theme';

export default function SearchScreen() {
  const mail = useMail();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const results = useMemo(() => searchMessages(mail.state.messages, query), [mail.state.messages, query]);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar kicker={mail.t('brand')} title={mail.t('search')} subtitle={mail.syncing ? mail.t('searchingServer') : mail.t('hotelLine')} />
      <Field label={mail.t('search')} value={query} onChangeText={setQuery} placeholder={mail.t('searchPlaceholder')} autoCapitalize="none" />
      <Button label={mail.syncing ? mail.t('searchingServer') : mail.t('searchServer')} disabled={mail.syncing || query.trim().length < 2} onPress={() => void mail.searchOnServer(query.trim())} />
      <FlatList
        style={{ flex: 1, marginTop: 12 }}
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={results.length === 0 ? { flexGrow: 1, justifyContent: 'center' } : { paddingBottom: 16 }}
        ListEmptyComponent={<Text style={{ textAlign: 'center', color: theme.muted, marginHorizontal: 32 }}>{query.trim() ? mail.t('emptySearch') : mail.t('searchPlaceholder')}</Text>}
        renderItem={({ item }) => {
          const account = mail.state.accounts.find((entry) => entry.id === item.accountId);
          return (
            <MessageRow
              from={item.from.name || item.from.email}
              subject={item.subject || mail.t('noSubject')}
              snippet={item.snippet}
              time={formatWhen(item.date, mail.locale)}
              account={account?.email ?? ''}
              unread={item.unread}
              flagged={item.flagged}
              attachment={item.hasAttachments}
              bar={item.color || account?.color || theme.accent}
              onPress={() => router.push({ pathname: '/message', params: { id: item.id } })}
            />
          );
        }}
      />
      <BottomBar />
    </View>
  );
}
