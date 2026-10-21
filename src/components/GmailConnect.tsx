import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, Text } from 'react-native';
import { googleClientIds, googleRedirectUri } from '../config';
import { publicError } from '../mail/redact';
import { useMail } from '../state/MailContext';
import { theme } from '../theme';
import { Button, Hint } from './chrome';

WebBrowser.maybeCompleteAuthSession();

const SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.modify',
];

export function GmailConnect({ onPassword }: { onPassword: () => void }) {
  const mail = useMail();
  const ids = googleClientIds();
  const clientId = Platform.OS === 'ios' ? ids.ios : ids.web || ids.ios;
  if (!clientId) {
    return (
      <>
        <Hint>{mail.t('gmailExplain')}</Hint>
        <Hint>{mail.t('gmailMissing')}</Hint>
        <Button label={mail.t('gmailPassword')} onPress={onPassword} tone="quiet" />
      </>
    );
  }
  return <GmailButton clientId={clientId} ios={ids.ios} web={ids.web} onPassword={onPassword} />;
}

function GmailButton({ clientId, ios, web, onPassword }: { clientId: string; ios: string; web: string; onPassword: () => void }) {
  const mail = useMail();
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const config = useMemo(() => {
    const base = {
      iosClientId: ios || clientId,
      webClientId: web || undefined,
      scopes: SCOPES,
      extraParams: { access_type: 'offline', prompt: 'consent select_account' },
    };
    if (Platform.OS === 'web') return base;
    return { ...base, redirectUri: googleRedirectUri(ios || clientId) };
  }, [clientId, ios, web]);
  const [request, response, promptAsync] = Google.useAuthRequest(config);
  const handled = useRef<typeof response>(null);

  useEffect(() => {
    if (!response || handled.current === response) return;
    handled.current = response;
    if (response.type !== 'success' && response.type !== 'error') {
      if (response.type === 'cancel' || response.type === 'dismiss') setError(mail.t('authCancelled'));
      return;
    }
    if (response.type === 'error' || !response.authentication?.accessToken) {
      const message = response.type === 'error' ? response.error?.message || response.params.error : '';
      setError(message || mail.t('connectionFailed'));
      return;
    }
    const accessToken = response.authentication.accessToken;
    const refreshToken = response.authentication.refreshToken;
    const expiresIn = response.authentication.expiresIn ?? 3600;
    setBusy(true);
    void (async () => {
      try {
        const profile = await googleProfile(accessToken);
        await mail.saveGmail(profile.email, profile.name, {
          accessToken,
          refreshToken,
          expiresAt: Date.now() + expiresIn * 1000,
          clientId: ios || clientId,
        });
        if (!refreshToken) setError(mail.t('sessionShort'));
        else router.back();
        void mail.refresh();
      } catch (caught) {
        setError(publicError(caught));
      } finally {
        setBusy(false);
      }
    })();
  }, [response]);

  return (
    <>
      <Hint>{mail.t('gmailExplain')}</Hint>
      <Hint>{mail.t('gmailTesting')}</Hint>
      <Button label={busy ? mail.t('working') : mail.t('gmailButton')} disabled={!request || busy} onPress={() => void promptAsync()} />
      {error ? <Text style={{ color: theme.danger, marginHorizontal: 20, marginTop: 12 }}>{error}</Text> : null}
      <Button label={mail.t('gmailPassword')} onPress={onPassword} tone="quiet" />
    </>
  );
}

async function googleProfile(accessToken: string): Promise<{ email: string; name: string }> {
  const headers = { Authorization: `Bearer ${accessToken}` };
  const user = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers });
  if (user.ok) {
    const json = await user.json() as { email?: string; name?: string };
    if (json.email) return { email: json.email, name: json.name || json.email };
  }
  const gmail = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers });
  if (!gmail.ok) throw new Error('Google не назвал адрес ящика.');
  const json = await gmail.json() as { emailAddress?: string };
  if (!json.emailAddress) throw new Error('Google не назвал адрес ящика.');
  return { email: json.emailAddress, name: json.emailAddress };
}
