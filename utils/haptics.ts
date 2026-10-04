import * as Haptics from 'expo-haptics';

/**
 * Universal Haptic Feedback utility for FISAT Smart Campus App
 * Provides consistent, tactile, native vibration responses across all platforms.
 */
export const triggerHaptic = {
  /**
   * Light impact: ideal for tabs, pills, chips, navigation icons, close buttons, list items
   */
  light: () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {}
  },

  /**
   * Medium impact: ideal for toggles, device power switches, save buttons, primary actions
   */
  medium: () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    } catch {}
  },

  /**
   * Heavy impact: ideal for delete buttons, resets, critical threshold toggles
   */
  heavy: () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    } catch {}
  },

  /**
   * Selection tick: ideal for rotary wheel turns, segmented controllers, sliders, radio selections
   */
  selection: () => {
    try {
      Haptics.selectionAsync().catch(() => {});
    } catch {}
  },

  /**
   * Success notification: confirmation of schedule saved, notice posted, time synchronized
   */
  success: () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch {}
  },

  /**
   * Warning notification: threshold exceeded, warning dialogs
   */
  warning: () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    } catch {}
  },

  /**
   * Error notification: connection failure, form validation error
   */
  error: () => {
    try {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => {});
    } catch {}
  },
};

export default triggerHaptic;
