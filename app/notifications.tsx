import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, Platform } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { ScreenHeader } from '../components/ScreenHeader';
import { useApp, useTheme } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { NotificationItem } from '../types';
import { triggerHaptic } from '../utils/haptics';

function NotificationCard({ 
  notification, 
  onPress, 
  onDismiss,
  styles,
  colors,
  isDark
}: { 
  notification: NotificationItem; 
  onPress: () => void; 
  onDismiss: () => void;
  styles: any;
  colors: any;
  isDark: boolean;
}) {
  const getIcon = (): keyof typeof Ionicons.glyphMap => {
    switch (notification.type) {
      case 'device-left-on': return 'alert-circle';
      case 'device-offline': return 'cloud-offline';
      case 'high-consumption': return 'flash';
      case 'classroom-vacant': return 'log-out';
      case 'controller-reconnected': return 'wifi';
      case 'maintenance-reminder': return 'construct';
      default: return 'notifications';
    }
  };

  const getIconColor = () => {
    switch (notification.type) {
      case 'device-left-on': return colors.warning;
      case 'device-offline': return colors.critical;
      case 'high-consumption': return colors.primary;
      case 'classroom-vacant': return colors.textMuted;
      case 'controller-reconnected': return colors.success;
      case 'maintenance-reminder': return colors.primary;
      default: return colors.text;
    }
  };

  const formatTime = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const iconColor = getIconColor();

  return (
    <TouchableOpacity 
      style={[styles.notifCard, !notification.isRead && styles.notifCardUnread]}
      activeOpacity={0.7}
      onPress={() => {
        triggerHaptic.light();
        onPress();
      }}
    >
      <View style={[styles.notifIcon, { backgroundColor: isDark ? `${iconColor}25` : `${iconColor}18` }]}>
        <Ionicons name={getIcon()} size={20} color={iconColor} />
      </View>
      <View style={styles.notifContent}>
        <View style={styles.notifHeader}>
          <Text style={[styles.notifTitle, !notification.isRead && styles.notifTitleUnread]} numberOfLines={1}>
            {notification.title}
          </Text>
          <Text style={styles.notifTime}>{formatTime(notification.time)}</Text>
        </View>
        <Text style={styles.notifMessage} numberOfLines={2}>{notification.message}</Text>
        {notification.classroomName && (
          <View style={styles.notifMeta}>
            <Ionicons name="location-outline" size={12} color={colors.textMuted} />
            <Text style={styles.notifMetaText}>{notification.classroomName}</Text>
          </View>
        )}
      </View>
      <TouchableOpacity 
        style={styles.dismissBtn} 
        onPress={(e) => {
          e.stopPropagation();
          triggerHaptic.medium();
          onDismiss();
        }}
        hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        activeOpacity={0.6}
      >
        <Ionicons name="close" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </TouchableOpacity>
  );
}

export default function NotificationsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { notifications, markNotificationRead, markAllNotificationsRead, deleteNotification, clearAllNotifications } = useApp();
  const { colors, isDark } = useTheme();

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const unreadCount = notifications.filter(n => !n.isRead).length;

  const handleClearAll = () => {
    if (notifications.length === 0) return;
    triggerHaptic.warning();

    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && window.confirm('Are you sure you want to clear all notifications?')) {
        triggerHaptic.heavy();
        clearAllNotifications();
      }
      return;
    }

    Alert.alert(
      'Clear All Notifications',
      'Are you sure you want to remove all notifications? This action cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => triggerHaptic.light() },
        { 
          text: 'Clear All', 
          style: 'destructive', 
          onPress: () => {
            triggerHaptic.heavy();
            clearAllNotifications();
          } 
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <ScreenHeader 
        title="Notifications" 
        showBack
        rightElement={
          notifications.length > 0 ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
              {unreadCount > 0 && (
                <TouchableOpacity 
                  onPress={() => {
                    triggerHaptic.light();
                    markAllNotificationsRead();
                  }} 
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={styles.markAllRead}>Mark all read</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity onPress={handleClearAll} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Text style={styles.clearAllTextTop}>Clear all</Text>
              </TouchableOpacity>
            </View>
          ) : undefined
        }
      />

      {unreadCount > 0 && (
        <View style={styles.unreadBanner}>
          <Text style={styles.unreadText}>{unreadCount} unread notification{unreadCount !== 1 ? 's' : ''}</Text>
        </View>
      )}

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {notifications.length > 0 ? (
          notifications.map(notif => (
            <NotificationCard
              key={notif.id}
              notification={notif}
              onPress={() => markNotificationRead(notif.id)}
              onDismiss={() => deleteNotification(notif.id)}
              styles={styles}
              colors={colors}
              isDark={isDark}
            />
          ))
        ) : (
          <View style={styles.emptyState}>
            <Ionicons name="notifications-off-outline" size={64} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>No notifications</Text>
            <Text style={styles.emptySubtitle}>You're all caught up!</Text>
          </View>
        )}
        <View style={{ height: 80 }} />
      </ScrollView>

      {/* Circular Close Button in Bottom Center */}
      <View style={[styles.bottomCenterContainer, { paddingBottom: Math.max(insets.bottom, 20) }]}>
        <TouchableOpacity
          style={styles.circularCloseBtn}
          onPress={() => {
            triggerHaptic.light();
            router.back();
          }}
          activeOpacity={0.8}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons
            name="close"
            size={24}
            color={isDark ? '#000000' : '#FFFFFF'}
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

function getStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: Layout.spacing.md,
    },
    markAllRead: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    unreadBanner: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.1)' : 'rgba(217, 119, 6, 0.08)',
      paddingVertical: 8,
      paddingHorizontal: Layout.spacing.md,
    },
    unreadText: {
      color: colors.primary,
      fontSize: 13,
      fontWeight: '600',
    },
    notifCard: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: Layout.radius.md,
      padding: 14,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    notifCardUnread: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.03)' : 'rgba(217, 119, 6, 0.03)',
    },
    notifIcon: {
      width: 36,
      height: 36,
      borderRadius: 18,
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    notifContent: {
      flex: 1,
      marginRight: 8,
    },
    notifHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 4,
    },
    notifTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '500',
      flex: 1,
      marginRight: 8,
    },
    notifTitleUnread: {
      fontWeight: '700',
    },
    notifTime: {
      color: colors.textMuted,
      fontSize: 11,
    },
    notifMessage: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      marginBottom: 6,
    },
    notifMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    notifMetaText: {
      color: colors.textMuted,
      fontSize: 12,
    },
    dismissBtn: {
      padding: 4,
      alignSelf: 'flex-start',
    },
    emptyState: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: 80,
      gap: 12,
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    emptySubtitle: {
      color: colors.textMuted,
      fontSize: 14,
    },
    clearAllTextTop: {
      color: colors.critical,
      fontSize: 14,
      fontWeight: '600',
    },
    bottomCenterContainer: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      alignItems: 'center',
      justifyContent: 'center',
      pointerEvents: 'box-none',
    },
    circularCloseBtn: {
      width: 52,
      height: 52,
      borderRadius: 26,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.25,
      shadowRadius: 8,
      elevation: 6,
    },
  });
}
