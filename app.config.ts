import type { ExpoConfig } from 'expo/config';

const googleIosClientId = process.env.GOOGLE_IOS_CLIENT_ID ?? '';
const googleWebClientId = process.env.GOOGLE_WEB_CLIENT_ID ?? '';
const easProjectId = process.env.EAS_PROJECT_ID ?? '';
// Off by default. Remote notifications add the aps-environment entitlement,
// and a profile without Push Notifications cannot sign that.
const pushEnabled = process.env.ENABLE_PUSH === '1';

function googleScheme(clientId: string): string | null {
  const suffix = '.apps.googleusercontent.com';
  if (!clientId.endsWith(suffix)) return null;
  return `com.googleusercontent.apps.${clientId.slice(0, -suffix.length)}`;
}

const plugins: NonNullable<ExpoConfig['plugins']> = [
  'expo-router',
  'expo-secure-store',
  'expo-background-task',
];
plugins.push([
  'expo-notifications',
  { color: '#C45C38', mode: 'production', enableRemoteNotifications: pushEnabled },
]);

const config: ExpoConfig = {
  name: 'Vellia Mail',
  slug: 'vellia-mail',
  scheme: ['velliamail', googleScheme(googleIosClientId)].filter((item): item is string => Boolean(item)),
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'light',
  ios: {
    bundleIdentifier: 'es.verkvest.velliamail',
    buildNumber: process.env.BUILD_NUMBER || '1',
    supportsTablet: true,
    backgroundColor: '#F3EADC',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      CFBundleDisplayName: 'Vellia Mail',
    },
  },
  android: {
    package: 'es.verkvest.velliamail',
    adaptiveIcon: {
      backgroundColor: '#C45C38',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins,
  extra: {
    googleIosClientId,
    googleWebClientId,
    ...(easProjectId ? { eas: { projectId: easProjectId } } : {}),
  },
};

export default config;
