import Constants from 'expo-constants';

export function googleClientIds(): { ios: string; web: string } {
  const extra = Constants.expoConfig?.extra as { googleIosClientId?: string; googleWebClientId?: string } | undefined;
  return {
    ios: extra?.googleIosClientId?.trim() ?? '',
    web: extra?.googleWebClientId?.trim() ?? '',
  };
}

export function googleRedirectUri(iosClientId: string): string {
  const suffix = '.apps.googleusercontent.com';
  const prefix = iosClientId.endsWith(suffix) ? iosClientId.slice(0, -suffix.length) : iosClientId;
  return `com.googleusercontent.apps.${prefix}:/oauthredirect`;
}
