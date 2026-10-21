import type { Condition, FilterInput, FilterResult, FilterRule, FilterSnapshot, MailMessage } from './types';

function fieldValue(input: FilterInput, field: Condition['field']): string {
  if (field === 'account') return input.accountEmail;
  return input[field] ?? '';
}

function matchesCondition(input: FilterInput, condition: Condition): boolean {
  const haystack = fieldValue(input, condition.field).toLocaleLowerCase();
  const needle = condition.value.trim().toLocaleLowerCase();
  if (!needle) return false;
  switch (condition.op) {
    case 'contains':
      return haystack.includes(needle);
    case 'notContains':
      return !haystack.includes(needle);
    case 'equals':
      return haystack === needle;
    case 'startsWith':
      return haystack.startsWith(needle);
    case 'endsWith':
      return haystack.endsWith(needle);
    default:
      return false;
  }
}

function ruleMatches(input: FilterInput, rule: FilterRule): boolean {
  if (!rule.enabled || rule.conditions.length === 0) return false;
  const results = rule.conditions.map((condition) => matchesCondition(input, condition));
  return rule.match === 'any' ? results.some(Boolean) : results.every(Boolean);
}

export function messageFilterInput(message: Pick<MailMessage, 'from' | 'to' | 'cc' | 'subject' | 'text'>, accountEmail: string): FilterInput {
  const join = (items: { name: string; email: string }[]) =>
    items.map((item) => `${item.name} ${item.email}`).join(' ');
  return {
    from: `${message.from.name} ${message.from.email}`,
    to: join(message.to),
    cc: join(message.cc),
    subject: message.subject,
    body: message.text,
    accountEmail,
  };
}

export function applyFilterRules(input: FilterInput, rules: FilterRule[], snapshot: FilterSnapshot): FilterResult {
  const ordered = [...rules].sort((a, b) => a.order - b.order);
  let unread = snapshot.unread;
  let flagged = snapshot.flagged;
  const labelIds = [...snapshot.labelIds];
  let color = snapshot.color;
  const matchedRuleIds: string[] = [];
  let remoteMarkRead = false;
  let remoteFlag = false;

  for (const rule of ordered) {
    if (!ruleMatches(input, rule)) continue;
    matchedRuleIds.push(rule.id);
    let stop = false;
    for (const action of rule.actions) {
      if (action.type === 'addLabel' && action.labelId && !labelIds.includes(action.labelId)) labelIds.push(action.labelId);
      if (action.type === 'markRead' && unread) {
        unread = false;
        remoteMarkRead = true;
      }
      if (action.type === 'flag' && !flagged) {
        flagged = true;
        remoteFlag = true;
      }
      if (action.type === 'unflag') flagged = false;
      if (action.type === 'color' && action.color) color = action.color;
      if (action.type === 'stop') stop = true;
    }
    if (stop) break;
  }

  const result: FilterResult = { unread, flagged, labelIds, matchedRuleIds, remoteMarkRead, remoteFlag };
  if (color) result.color = color;
  return result;
}
