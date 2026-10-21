import { useRouter } from 'expo-router';
import { ScrollView, View } from 'react-native';
import { Button, Cell, Group, Hint, NavBar } from '../../../components/chrome';
import { useMail } from '../../../state/MailContext';
import { theme } from '../../../theme';

export default function TemplatesScreen() {
  const mail = useMail();
  const router = useRouter();
  const templates = [...mail.state.templates].sort((a, b) => a.order - b.order);
  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavBar title={mail.t('templates')} onBack={() => router.back()} />
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <Hint>{mail.t('placeholderHelp')}</Hint>
        {templates.length === 0 ? <Hint>{mail.t('templatesEmpty')}</Hint> : (
          <Group style={{ marginTop: 16 }}>
            {templates.map((template, index) => (
              <Cell
                key={template.id}
                title={template.title}
                subtitle={template.body.replace(/\s+/g, ' ').slice(0, 80)}
                onPress={() => router.push({ pathname: '/settings/templates/[id]', params: { id: template.id } })}
                last={index === templates.length - 1}
              />
            ))}
          </Group>
        )}
        <Button label={mail.t('templateNew')} onPress={() => router.push({ pathname: '/settings/templates/[id]', params: { id: 'new' } })} />
      </ScrollView>
    </View>
  );
}
