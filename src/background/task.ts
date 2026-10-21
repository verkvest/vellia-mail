export const BACKGROUND_TASK = 'vellia-mail-sync';

export async function registerBackgroundSync(): Promise<string> {
  return 'restricted';
}

export async function notificationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  return 'undetermined';
}

export async function previewNotification(_body: string): Promise<void> {
  throw new Error('Уведомления приходят на iPhone, не в браузер.');
}
