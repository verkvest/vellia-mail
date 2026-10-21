import { useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { BottomBar, Cell, Group, Section, TopBar } from '../../components/chrome';
import type { Locale } from '../../mail/types';
import { useMail } from '../../state/MailContext';
import { theme } from '../../theme';

export default function SettingsScreen() {
  const mail = useMail();
  const router = useRouter();
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <TopBar kicker={mail.t('brand')} title={mail.t('settings')} subtitle={mail.t('hotelLine')} />
      <ScrollView contentContainerStyle={{ paddingBottom: 28 }}>
        <Section>{mail.t('accounts')}</Section>
        <Group>
          {mail.state.accounts.map((account) => (
            <Cell
              key={account.id}
              title={account.displayName}
              subtitle={account.email}
              color={account.color}
              value={account.kind === 'gmail' ? 'Google' : account.kind === 'demo' ? 'demo' : 'IMAP'}
              onPress={() => router.push({ pathname: '/settings/account/[id]', params: { id: account.id } })}
            />
          ))}
          <Cell title={mail.t('addAccount')} onPress={() => router.push('/settings/account-new')} last />
        </Group>
        <TextHint>{mail.t('accountsHelp')}</TextHint>
        <Section>{mail.t('filters')}</Section>
        <Group>
          <Cell title={mail.t('filters')} subtitle={mail.t('samplesReady')} value={String(mail.state.rules.length)} onPress={() => router.push('/settings/filters')} last />
        </Group>
        <Section>{mail.t('templates')}</Section>
        <Group>
          <Cell title={mail.t('templates')} value={String(mail.state.templates.length)} onPress={() => router.push('/settings/templates')} last />
        </Group>
        <Section>{mail.t('signatures')}</Section>
        <Group>
          {mail.state.accounts.map((account, index) => (
            <Cell
              key={account.id}
              title={account.displayName}
              subtitle={mail.state.signatures[account.id]?.body ? mail.t('signatureOn') : mail.t('noSignature')}
              color={account.color}
              onPress={() => router.push({ pathname: '/settings/signature', params: { accountId: account.id } })}
              last={index === mail.state.accounts.length - 1}
            />
          ))}
        </Group>
        <Section>{mail.t('notifications')}</Section>
        <Group>
          <Cell title={mail.t('notifications')} subtitle={mail.t('backgroundToggle')} onPress={() => router.push('/settings/notifications')} last />
        </Group>
        <Section>{mail.t('language')}</Section>
        <Group>
          {(['ru', 'es', 'en'] as Locale[]).map((locale, index) => (
            <Cell
              key={locale}
              title={locale === 'ru' ? mail.t('languageRu') : locale === 'es' ? mail.t('languageEs') : mail.t('languageEn')}
              value={mail.locale === locale ? '✓' : ''}
              onPress={() => void mail.setLocale(locale)}
              last={index === 2}
            />
          ))}
        </Group>
        <Section>{mail.t('about')}</Section>
        <TextHint>{mail.t('aboutBody')}</TextHint>
        <TextHint>{mail.t('privacyBody')}</TextHint>
        <TextHint>{mail.t('versionLabel')}</TextHint>
      </ScrollView>
      <BottomBar />
    </View>
  );
}

function TextHint({ children }: { children: string }) {
  return <Text style={{ color: theme.muted, fontSize: 14, lineHeight: 20, marginHorizontal: 20, marginTop: 8 }}>{children}</Text>;
}
