import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Button, Field, Hint, NavBar, one } from '../../../components/chrome';
import { createId, type Template } from '../../../mail/types';
import { useMail } from '../../../state/MailContext';
import { theme } from '../../../theme';

export default function TemplateEditor() {
  const mail = useMail();
  const router = useRouter();
  const id = one(useLocalSearchParams<{ id?: string }>().id);
  const existing = id === 'new' ? undefined : mail.state.templates.find((item) => item.id === id);
  const [draft, setDraft] = useState<Template>(() => existing ?? {
    id: createId('tpl'),
    title: '',
    body: '',
    order: Math.max(0, ...mail.state.templates.map((item) => item.order)) + 1,
  });
  const [error, setError] = useState('');

  function save() {
    if (!draft.title.trim() || !draft.body.trim()) {
      setError(mail.t('templateMissing'));
      return;
    }
    void mail.saveTemplate({ ...draft, title: draft.title.trim(), body: draft.body.replace(/\s+$/, '') });
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavBar title={id === 'new' ? mail.t('templateNew') : draft.title || mail.t('templates')} onBack={() => router.back()} right={mail.t('save')} onRight={save} />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
        <Hint>{mail.t('placeholderHelp')}</Hint>
        <Field label={mail.t('templateTitle')} value={draft.title} onChangeText={(title) => setDraft({ ...draft, title })} />
        <Field label={mail.t('templateBody')} value={draft.body} onChangeText={(body) => setDraft({ ...draft, body })} multiline />
        {error ? <Text style={{ color: theme.danger, marginHorizontal: 20, marginTop: 12 }}>{error}</Text> : null}
        <Button label={mail.t('save')} onPress={save} />
        {id !== 'new' ? <Button label={mail.t('deleteTemplate')} tone="danger" onPress={() => { void mail.deleteTemplate(id); router.back(); }} /> : null}
      </ScrollView>
    </View>
  );
}
