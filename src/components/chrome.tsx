import { usePathname, useRouter } from 'expo-router';
import { type ReactNode } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps, type ViewStyle } from 'react-native';
import { swatches, theme } from '../theme';
import { useMail } from '../state/MailContext';

export function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export function NavBar({ title, subtitle, onBack, right, onRight }: { title: string; subtitle?: string; onBack?: () => void; right?: string; onRight?: () => void }) {
  const insets = useSafeAreaInsets();
  const mail = useMail();
  return (
    <View style={[styles.nav, { paddingTop: insets.top + 8 }]}>
      <View style={styles.navSide}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button">
            <Text style={styles.back}>{mail.t('back')}</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.navCenter}>
        <Text style={styles.navTitle} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={styles.navSub} numberOfLines={1}>{subtitle}</Text> : null}
      </View>
      <View style={[styles.navSide, styles.navRight]}>
        {right ? (
          <Pressable onPress={onRight} hitSlop={12} accessibilityRole="button">
            <Text style={styles.back}>{right}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function TopBar({ kicker, title, subtitle, action, onAction }: { kicker?: string; title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.top, { paddingTop: insets.top + 10 }]}>
      <View style={styles.topRow}>
        <View style={{ flex: 1 }}>
          {kicker ? <Text style={styles.kicker}>{kicker}</Text> : null}
          <Text style={styles.large}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {action ? (
          <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" style={styles.actionPill}>
            <Text style={styles.actionText}>{action}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function BottomBar() {
  const mail = useMail();
  const path = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const items: { href: '/' | '/folders' | '/search' | '/settings'; label: string; active: boolean; badge?: number }[] = [
    { href: '/', label: mail.t('inbox'), active: path === '/' || path === '/index', badge: mail.unreadCount },
    { href: '/folders', label: mail.t('folders'), active: path.startsWith('/folders') },
    { href: '/search', label: mail.t('search'), active: path.startsWith('/search') },
    { href: '/settings', label: mail.t('more'), active: path.startsWith('/settings') },
  ];
  return (
    <View style={[styles.tabs, { paddingBottom: Math.max(insets.bottom, 8) }]}>
      {items.map((item) => (
        <Pressable key={item.href} style={styles.tab} onPress={() => router.push(item.href)} accessibilityRole="button">
          <Text style={[styles.tabLabel, item.active && styles.tabOn]}>{item.label}</Text>
          {item.badge ? <Text style={[styles.badge, item.active && styles.badgeOn]}>{item.badge > 99 ? '99+' : item.badge}</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

export function Banner({ text, onClose }: { text: string; onClose?: () => void }) {
  const mail = useMail();
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>{text}</Text>
      {onClose ? (
        <Pressable onPress={onClose} hitSlop={8}>
          <Text style={styles.bannerClose}>{mail.t('clearError')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function Section({ children }: { children: string }) {
  return <Text style={styles.section}>{children}</Text>;
}

export function Hint({ children }: { children: string }) {
  return <Text style={styles.hint}>{children}</Text>;
}

export function Group({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  return <View style={[styles.group, style]}>{children}</View>;
}

export function Cell({
  title,
  subtitle,
  value,
  color,
  onPress,
  destructive,
  last,
}: {
  title: string;
  subtitle?: string;
  value?: string;
  color?: string;
  onPress?: () => void;
  destructive?: boolean;
  last?: boolean;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={[styles.cell, !last && styles.cellLine]} accessibilityRole={onPress ? 'button' : undefined}>
      {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <View style={{ flex: 1 }}>
        <Text style={[styles.cellTitle, destructive && { color: theme.danger }]}>{title}</Text>
        {subtitle ? <Text style={styles.cellSub} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {value ? <Text style={styles.cellValue}>{value}</Text> : null}
      {onPress ? <Text style={styles.chevron}>›</Text> : null}
    </Pressable>
  );
}

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & TextInputProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        placeholderTextColor={theme.faint}
        autoCorrect={false}
        {...input}
        style={[styles.input, input.multiline && styles.inputMulti, input.style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Button({ label, onPress, disabled, tone = 'accent' }: { label: string; onPress: () => void; disabled?: boolean; tone?: 'accent' | 'good' | 'quiet' | 'danger' }) {
  return (
    <Pressable disabled={disabled} onPress={onPress} accessibilityRole="button" style={[styles.button, tone === 'good' && { backgroundColor: theme.good }, tone === 'quiet' && styles.buttonQuiet, tone === 'danger' && { backgroundColor: theme.danger }, disabled && styles.disabled]}>
      <Text style={[styles.buttonText, tone === 'quiet' && { color: theme.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, selected, color, onPress }: { label: string; selected?: boolean; color?: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipOn, color ? { borderColor: color } : null]} accessibilityRole="button">
      {color ? <View style={[styles.chipDot, { backgroundColor: color }]} /> : null}
      <Text style={[styles.chipText, selected && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

export function Swatches({ value, onChange }: { value?: string; onChange: (color: string | undefined) => void }) {
  return (
    <View style={styles.swatches}>
      {swatches.map((color) => (
        <Pressable
          key={color}
          onPress={() => onChange(value === color ? undefined : color)}
          accessibilityRole="button"
          style={[styles.swatch, { backgroundColor: color }, value === color && styles.swatchOn]}
        />
      ))}
    </View>
  );
}

export function MessageRow({
  from,
  subject,
  snippet,
  time,
  account,
  label,
  unread,
  flagged,
  attachment,
  bar,
  onPress,
}: {
  from: string;
  subject: string;
  snippet: string;
  time: string;
  account: string;
  label?: string;
  unread: boolean;
  flagged: boolean;
  attachment: boolean;
  bar: string;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={styles.row} accessibilityRole="button">
      <View style={[styles.bar, { backgroundColor: bar }]} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={[styles.from, unread && styles.unread]} numberOfLines={1}>{from}</Text>
          <Text style={styles.time}>{time}</Text>
        </View>
        <Text style={[styles.subject, unread && styles.unread]} numberOfLines={1}>{subject}</Text>
        <Text style={styles.snippet} numberOfLines={2}>{snippet}</Text>
        <View style={styles.meta}>
          <Text style={styles.metaText} numberOfLines={1}>{account}{label ? ` · ${label}` : ''}</Text>
          {attachment ? <View style={styles.clip} /> : null}
          {flagged ? <View style={styles.flag} /> : null}
          {unread ? <View style={styles.unreadDot} /> : null}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  nav: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 10, backgroundColor: theme.bg },
  navSide: { width: 88 },
  navRight: { alignItems: 'flex-end' },
  navCenter: { flex: 1, alignItems: 'center' },
  navTitle: { fontSize: 17, fontWeight: '600', color: theme.ink },
  navSub: { fontSize: 12, color: theme.muted, marginTop: 2 },
  back: { color: theme.accent, fontSize: 17 },
  top: { paddingHorizontal: 20, paddingBottom: 8 },
  topRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  kicker: { color: theme.accent, fontSize: 13, fontWeight: '700', letterSpacing: 1.4 },
  large: { fontSize: 34, fontWeight: '700', color: theme.ink, letterSpacing: -0.6 },
  subtitle: { color: theme.muted, fontSize: 15, marginTop: 2 },
  actionPill: { backgroundColor: theme.paper, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
  actionText: { color: theme.accent, fontWeight: '600' },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.line, backgroundColor: theme.paper, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 2, minHeight: 36 },
  tabLabel: { fontSize: 12, color: theme.faint, fontWeight: '600' },
  tabOn: { color: theme.accent },
  badge: { fontSize: 11, color: theme.muted },
  badgeOn: { color: theme.accentDark },
  banner: { marginHorizontal: 16, marginBottom: 8, backgroundColor: '#F6E4D4', borderRadius: 12, padding: 12, gap: 6 },
  bannerText: { color: theme.ink, fontSize: 14, lineHeight: 20 },
  bannerClose: { color: theme.accentDark, fontWeight: '600' },
  section: { marginTop: 22, marginBottom: 8, marginHorizontal: 20, color: theme.muted, fontSize: 13, fontWeight: '600' },
  hint: { color: theme.muted, fontSize: 13, lineHeight: 18, marginHorizontal: 20, marginTop: 8 },
  group: { marginHorizontal: 16, backgroundColor: theme.paper, borderRadius: 14, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
  cell: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  cellLine: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.line },
  cellTitle: { fontSize: 16, color: theme.ink },
  cellSub: { fontSize: 13, color: theme.muted, marginTop: 2 },
  cellValue: { color: theme.muted, fontSize: 15 },
  chevron: { color: theme.faint, fontSize: 20, marginLeft: 4 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  field: { marginHorizontal: 16, marginTop: 14 },
  fieldLabel: { color: theme.muted, fontSize: 13, marginBottom: 6, fontWeight: '600' },
  input: { backgroundColor: theme.paper, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line, paddingHorizontal: 12, paddingVertical: 12, fontSize: 16, color: theme.ink },
  inputMulti: { minHeight: 140, textAlignVertical: 'top' },
  button: { marginHorizontal: 16, marginTop: 16, backgroundColor: theme.accent, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  buttonQuiet: { backgroundColor: theme.chip },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, backgroundColor: theme.chip, borderWidth: 1, borderColor: 'transparent' },
  chipOn: { backgroundColor: theme.paper, borderColor: theme.accent },
  chipDot: { width: 8, height: 8, borderRadius: 4 },
  chipText: { color: theme.ink, fontSize: 14, maxWidth: 180 },
  chipTextOn: { fontWeight: '700' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: theme.line },
  swatchOn: { borderWidth: 3, borderColor: theme.ink },
  row: { flexDirection: 'row', backgroundColor: theme.paper, borderRadius: 14, marginHorizontal: 16, marginBottom: 8, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: theme.line },
  bar: { width: 5 },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 12, paddingTop: 10 },
  from: { flex: 1, marginLeft: 12, fontSize: 16, color: theme.ink },
  unread: { fontWeight: '700' },
  time: { color: theme.muted, fontSize: 13 },
  subject: { marginLeft: 12, marginRight: 12, marginTop: 2, fontSize: 15, color: theme.ink },
  snippet: { marginLeft: 12, marginRight: 12, marginTop: 2, color: theme.muted, fontSize: 14, lineHeight: 18 },
  meta: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12, marginRight: 12, marginTop: 6, marginBottom: 10 },
  metaText: { flex: 1, color: theme.faint, fontSize: 12 },
  clip: { width: 8, height: 10, borderWidth: 1.5, borderColor: theme.sea, borderRadius: 2 },
  flag: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: theme.sand },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: theme.accent },
});
