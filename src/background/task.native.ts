import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { createDemoState } from '../mail/demo';
import { normalizeState } from '../mail/mailbox';
import { kv } from '../platform/kv';
import { syncAll, withMailboxLock } from '../sync/engine';

export const BACKGROUND_TASK = 'vellia-mail-sync';

if (Platform.OS !== 'web') {
  TaskManager.defineTask(BACKGROUND_TASK, async () => {
    try {
      await withMailboxLock(async () => {
        const loaded = normalizeState(await kv.load()) ?? createDemoState();
        if (!loaded.settings.backgroundSyncEnabled) return;
        const outcome = await syncAll(loaded, true);
        await kv.save(outcome.state);
      });
      return BackgroundTask.BackgroundTaskResult.Success;
    } catch {
      return BackgroundTask.BackgroundTaskResult.Failed;
    }
  });
}

export async function registerBackgroundSync(): Promise<string> {
  if (Platform.OS === 'web') return 'restricted';
  const status = await BackgroundTask.getStatusAsync();
  const registered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_TASK);
  if (!registered) {
    await BackgroundTask.registerTaskAsync(BACKGROUND_TASK, { minimumInterval: 15 });
  }
  if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return 'restricted';
  if (status === BackgroundTask.BackgroundTaskStatus.Available) return 'available';
  return 'unknown';
}

export async function notificationPermission(): Promise<'granted' | 'denied' | 'undetermined'> {
  if (Platform.OS === 'web') return 'undetermined';
  const Notifications = await import('expo-notifications');
  const current = await Notifications.getPermissionsAsync();
  if (current.status === 'granted') return 'granted';
  const asked = await Notifications.requestPermissionsAsync();
  return asked.status === 'granted' ? 'granted' : 'denied';
}

export async function previewNotification(body: string): Promise<void> {
  if (Platform.OS === 'web') throw new Error('Уведомления приходят на iPhone, не в браузер.');
  await notificationPermission();
  const Notifications = await import('expo-notifications');
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Vellia Mail', body },
    trigger: null,
  });
}
