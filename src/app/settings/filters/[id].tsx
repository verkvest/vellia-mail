import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Switch, Text, View } from 'react-native';
import { Button, Chip, Field, NavBar, Swatches, one } from '../../../components/chrome';
import type { Condition, ConditionField, ConditionOp, FilterAction, FilterRule, MatchMode } from '../../../mail/types';
import { createId } from '../../../mail/types';
import { useMail } from '../../../state/MailContext';
import { theme } from '../../../theme';

const FIELDS: ConditionField[] = ['from', 'to', 'cc', 'subject', 'account', 'body'];
const OPS: ConditionOp[] = ['contains', 'notContains', 'equals', 'startsWith', 'endsWith'];
const ACTION_TYPES = ['addLabel', 'markRead', 'flag', 'unflag', 'color', 'stop'] as const;

export default function FilterEditor() {
  const mail = useMail();
  const router = useRouter();
  const id = one(useLocalSearchParams<{ id?: string }>().id);
  const existing = id === 'new' ? undefined : mail.state.rules.find((rule) => rule.id === id);
  const [draft, setDraft] = useState<FilterRule>(() => existing ? clone(existing) : fresh(mail.state.rules, mail.state.labels[0]?.id));
  const [error, setError] = useState('');
  if (id !== 'new' && !existing && !draft.name && draft.conditions.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.bg }}>
        <NavBar title={mail.t('filters')} onBack={() => router.back()} />
      </View>
    );
  }

  function fieldLabel(field: ConditionField): string {
    if (field === 'from') return mail.t('fieldFrom');
    if (field === 'to') return mail.t('fieldTo');
    if (field === 'cc') return mail.t('fieldCc');
    if (field === 'subject') return mail.t('fieldSubject');
    if (field === 'account') return mail.t('fieldAccount');
    return mail.t('fieldBody');
  }
  function opLabel(op: ConditionOp): string {
    if (op === 'contains') return mail.t('opContains');
    if (op === 'notContains') return mail.t('opNotContains');
    if (op === 'equals') return mail.t('opEquals');
    if (op === 'startsWith') return mail.t('opStarts');
    return mail.t('opEnds');
  }
  function actionLabel(type: FilterAction['type']): string {
    if (type === 'addLabel') return mail.t('actionLabel');
    if (type === 'markRead') return mail.t('actionRead');
    if (type === 'flag') return mail.t('actionFlag');
    if (type === 'unflag') return mail.t('actionUnflag');
    if (type === 'color') return mail.t('actionColor');
    return mail.t('actionStop');
  }

  function save() {
    if (!draft.name.trim()) {
      setError(mail.t('ruleNameMissing'));
      return;
    }
    const conditions = draft.conditions.filter((condition) => condition.value.trim());
    if (!conditions.length) {
      setError(mail.t('required'));
      return;
    }
    if (draft.actions.some((action) => action.type === 'addLabel' && !action.labelId)) {
      setError(mail.t('labelMissing'));
      return;
    }
    void mail.saveRule({ ...draft, name: draft.name.trim(), conditions });
    router.back();
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.bg }}>
      <NavBar title={id === 'new' ? mail.t('filterNew') : draft.name || mail.t('filters')} onBack={() => router.back()} right={mail.t('save')} onRight={save} />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
        <Field label={mail.t('filterName')} value={draft.name} onChangeText={(name) => setDraft({ ...draft, name })} />
        <View style={row}>
          <Text style={label}>{mail.t('enabled')}</Text>
          <Switch value={draft.enabled} onValueChange={(enabled) => setDraft({ ...draft, enabled })} trackColor={{ true: theme.accent, false: theme.line }} />
        </View>
        <Text style={label}>{mail.t('matchHow')}</Text>
        <View style={wrap}>
          {(['all', 'any'] as MatchMode[]).map((mode) => (
            <Chip key={mode} label={mode === 'all' ? mail.t('matchAll') : mail.t('matchAny')} selected={draft.match === mode} onPress={() => setDraft({ ...draft, match: mode })} />
          ))}
        </View>
        <Text style={label}>{mail.t('conditions')}</Text>
        {draft.conditions.map((condition, index) => (
          <View key={index} style={card}>
            <View style={wrap}>
              {FIELDS.map((field) => (
                <Chip key={field} label={fieldLabel(field)} selected={condition.field === field} onPress={() => updateCondition(index, { field })} />
              ))}
            </View>
            <View style={wrap}>
              {OPS.map((op) => (
                <Chip key={op} label={opLabel(op)} selected={condition.op === op} onPress={() => updateCondition(index, { op })} />
              ))}
            </View>
            <Field label={mail.t('value')} value={condition.value} onChangeText={(value) => updateCondition(index, { value })} autoCapitalize="none" />
            <Button label={mail.t('remove')} tone="quiet" onPress={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, item) => item !== index) })} />
          </View>
        ))}
        <Button label={mail.t('addCondition')} tone="quiet" onPress={() => setDraft({ ...draft, conditions: [...draft.conditions, { field: 'from', op: 'contains', value: '' }] })} />
        <Text style={label}>{mail.t('actions')}</Text>
        {draft.actions.map((action, index) => (
          <View key={index} style={card}>
            <View style={wrap}>
              {ACTION_TYPES.map((type) => (
                <Chip key={type} label={actionLabel(type)} selected={action.type === type} onPress={() => updateAction(index, actionOf(type, mail.state.labels[0]?.id))} />
              ))}
            </View>
            {action.type === 'addLabel' ? (
              <View style={wrap}>
                {mail.state.labels.map((item) => (
                  <Chip key={item.id} label={item.name} color={item.color} selected={action.labelId === item.id} onPress={() => updateAction(index, { type: 'addLabel', labelId: item.id })} />
                ))}
              </View>
            ) : null}
            {action.type === 'color' ? <View style={{ marginHorizontal: 16, marginTop: 8 }}><Swatches value={action.color} onChange={(color) => updateAction(index, { type: 'color', color: color ?? action.color })} /></View> : null}
            <Button label={mail.t('remove')} tone="quiet" onPress={() => setDraft({ ...draft, actions: draft.actions.filter((_, item) => item !== index) })} />
          </View>
        ))}
        <Button label={mail.t('addAction')} tone="quiet" onPress={() => setDraft({ ...draft, actions: [...draft.actions, { type: 'markRead' }] })} />
        {error ? <Text style={bad}>{error}</Text> : null}
        <Button label={mail.t('save')} onPress={save} />
        {id !== 'new' ? <Button label={mail.t('deleteRule')} tone="danger" onPress={() => { void mail.deleteRule(id); router.back(); }} /> : null}
      </ScrollView>
    </View>
  );

  function updateCondition(index: number, patch: Partial<Condition>) {
    setDraft({
      ...draft,
      conditions: draft.conditions.map((condition, item) => item === index ? { ...condition, ...patch } : condition),
    });
  }
  function updateAction(index: number, action: FilterAction) {
    setDraft({ ...draft, actions: draft.actions.map((item, position) => position === index ? action : item) });
  }
}

function fresh(rules: FilterRule[], labelId: string | undefined): FilterRule {
  return {
    id: createId('rule'),
    name: '',
    enabled: true,
    order: Math.max(0, ...rules.map((rule) => rule.order)) + 1,
    match: 'all',
    conditions: [{ field: 'from', op: 'contains', value: '' }],
    actions: labelId ? [{ type: 'addLabel', labelId }] : [{ type: 'markRead' }],
  };
}

function clone(rule: FilterRule): FilterRule {
  return { ...rule, conditions: rule.conditions.map((condition) => ({ ...condition })), actions: rule.actions.map((action) => ({ ...action })) };
}

function actionOf(type: FilterAction['type'], labelId?: string): FilterAction {
  if (type === 'addLabel') return { type, labelId: labelId ?? '' };
  if (type === 'color') return { type, color: '#C45C38' };
  return { type };
}

const label = { marginHorizontal: 20, marginTop: 18, marginBottom: 8, color: theme.muted, fontWeight: '600' as const };
const wrap = { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, marginHorizontal: 16 };
const row = { marginHorizontal: 20, marginTop: 16, flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const };
const card = { marginTop: 10, paddingBottom: 8, borderTopWidth: 1, borderTopColor: theme.line };
const bad = { color: theme.danger, marginHorizontal: 20, marginTop: 12 };
