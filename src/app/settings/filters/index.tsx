import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Cell, Group, Hint, NavBar } from '../../../components/chrome';
import { useMail } from '../../../state/MailContext';
import { theme } from '../../../theme';

export default function FiltersScreen() {
  const mail = useMail();
  const router = useRouter();
  const rules = [...mail.state.rules].sort((a, b) => a.order - b.order);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavBar title={mail.t('filters')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Hint>{mail.t('rulesHelp')}</Hint>
        {rules.length === 0 ? <Hint>{mail.t('rulesEmpty')}</Hint> : (
          <Group style={{ marginTop: 16 }}>
            {rules.map((rule, index) => (
              <Cell
                key={rule.id}
                title={rule.name}
                subtitle={rule.enabled ? mail.t('enabled') : undefined}
                onPress={() => router.push({ pathname: '/settings/filters/[id]', params: { id: rule.id } })}
                last={index === rules.length - 1}
              />
            ))}
          </Group>
        )}
        <Button label={mail.t('filterNew')} onPress={() => router.push({ pathname: '/settings/filters/[id]', params: { id: 'new' } })} />
      </ScrollView>
    </View>
  );
}
