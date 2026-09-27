import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert as RNAlert,
  Platform,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { Layout } from '../../constants/layout';
import { ScreenHeader } from '../../components/ScreenHeader';
import { NoticeModal } from '../../components/NoticeModal';
import { useApp, useTheme } from '../../context/AppContext';
import { NoticeItem } from '../../types';
import { Ionicons } from '@expo/vector-icons';

type ScopeFilter = 'All' | 'Broadcast' | 'A101' | 'A102';

export default function AnnouncementsScreen() {
  const { notices, deleteNotice, esp32Connected, esp32Ip } = useApp();
  const { colors, isDark } = useTheme();
  const [activeFilter, setActiveFilter] = useState<ScopeFilter>('All');
  const [modalVisible, setModalVisible] = useState(false);
  const [defaultTarget, setDefaultTarget] = useState<'all' | 'cls-a101' | 'cls-a102'>('all');

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const filteredNotices = notices.filter((n) => {
    if (activeFilter === 'All') return true;
    if (activeFilter === 'Broadcast') return n.classroomId === 'all';
    if (activeFilter === 'A101') return n.classroomId === 'cls-a101' || n.classroomId === 'all';
    if (activeFilter === 'A102') return n.classroomId === 'cls-a102' || n.classroomId === 'all';
    return true;
  });

  const handleDelete = (id: string, title: string) => {
    if (Platform.OS === 'web') {
      const confirmed = typeof window !== 'undefined'
        ? window.confirm(`Are you sure you want to remove "${title}" from the digital notice board?`)
        : true;
      if (confirmed) {
        void deleteNotice(id);
      }
      return;
    }

    RNAlert.alert(
      'Delete Announcement',
      `Are you sure you want to remove "${title}" from the digital notice board?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void deleteNotice(id);
          },
        },
      ]
    );
  };

  const formatExpiry = (notice: NoticeItem) => {
    if (notice.duration === 'never' || !notice.expiresAt) return 'Pinned';
    const diffMs = new Date(notice.expiresAt).getTime() - Date.now();
    if (diffMs <= 0) return 'Expired';
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffMins = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    if (diffHours > 0) return `${diffHours}h ${diffMins}m left`;
    return `${diffMins}m left`;
  };

  const openNewModal = (target: 'all' | 'cls-a101' | 'cls-a102' = 'all') => {
    setDefaultTarget(target);
    setModalVisible(true);
  };

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Notice Board"
        rightElement={
          <TouchableOpacity
            style={styles.headerAddBtn}
            onPress={() => openNewModal('all')}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={20} color={isDark ? '#000000' : '#FFFFFF'} />
            <Text style={styles.headerAddText}>New Notice</Text>
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Hardware Status Banner */}
        <View style={styles.hardwareBanner}>
          <View style={styles.hardwareLeft}>
            <View style={[styles.hardwareDot, { backgroundColor: esp32Connected ? colors.success : colors.textMuted }]} />
            <View>
              <Text style={styles.hardwareTitle}>
                Classroom Notice Board ({esp32Connected ? 'Active' : 'Standby'})
              </Text>
              <Text style={styles.hardwareSub}>
                Digital Display
              </Text>
            </View>
          </View>
          <Ionicons name="easel-outline" size={22} color={colors.primary} />
        </View>

        {/* Quick Action Cards */}
        <View style={styles.actionsRow}>
          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => openNewModal('all')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconBox, { backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)' }]}>
              <Ionicons name="megaphone" size={18} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Broadcast Notice</Text>
              <Text style={styles.actionDesc}>Sends to all classroom displays</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.actionCard}
            onPress={() => openNewModal('cls-a101')}
            activeOpacity={0.8}
          >
            <View style={[styles.actionIconBox, { backgroundColor: isDark ? 'rgba(73, 199, 121, 0.15)' : 'rgba(21, 128, 61, 0.12)' }]}>
              <Ionicons name="business" size={18} color={colors.success} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.actionTitle}>Room Notice</Text>
              <Text style={styles.actionDesc}>Target specific classroom</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* Filter Pills */}
        <View style={styles.filterRow}>
          {(['All', 'Broadcast', 'A101', 'A102'] as ScopeFilter[]).map((f) => {
            const isSelected = activeFilter === f;
            return (
              <TouchableOpacity
                key={f}
                style={[styles.filterPill, isSelected && styles.filterPillActive]}
                onPress={() => setActiveFilter(f)}
                activeOpacity={0.7}
              >
                <Text style={[styles.filterPillText, isSelected && styles.filterPillTextActive]}>
                  {f === 'All' ? `All (${notices.length})` : f}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Announcements List */}
        <View style={styles.listSection}>
          <View style={styles.listHeaderRow}>
            <Text style={styles.listTitle}>
              Active Announcements ({filteredNotices.length})
            </Text>
            <Text style={styles.listSubtitle}>Auto-rotates every 20s</Text>
          </View>

          {filteredNotices.length > 0 ? (
            filteredNotices.map((item) => (
              <View key={item.id} style={styles.noticeCard}>
                {/* Notice Top Meta */}
                <View style={styles.noticeTopRow}>
                  <View style={styles.scopeBadge}>
                    <Ionicons
                      name={item.classroomId === 'all' ? 'megaphone' : 'business'}
                      size={12}
                      color={item.classroomId === 'all' ? colors.primary : colors.textSecondary}
                    />
                    <Text
                      style={[
                        styles.scopeBadgeText,
                        item.classroomId === 'all' && { color: colors.primary },
                      ]}
                    >
                      {item.classroomId === 'all' ? 'Broadcast (All Classrooms)' : (item.classroomName || item.classroomId)}
                    </Text>
                  </View>

                  <View style={styles.metaRight}>
                    <View style={styles.durationBadge}>
                      <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                      <Text style={styles.durationText}>{formatExpiry(item)}</Text>
                    </View>
                    <TouchableOpacity
                      style={styles.deleteBtn}
                      onPress={() => handleDelete(item.id, item.title)}
                      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.critical} />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Title */}
                <Text style={styles.noticeTitle}>{item.title}</Text>

                {/* Full Message Body (No truncation on full screen) */}
                <Text style={styles.noticeMessage}>{item.message}</Text>

                {/* Footer */}
                <View style={styles.noticeFooter}>
                  <Text style={styles.timestampText}>
                    Created: {new Date(item.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })} at {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                  <View style={styles.oledSyncBadge}>
                    <View style={styles.syncDot} />
                    <Text style={styles.syncText}>Live on Display</Text>
                  </View>
                </View>
              </View>
            ))
          ) : (
            <View style={styles.emptyCard}>
              <Ionicons name="notifications-off-outline" size={36} color={colors.textMuted} />
              <Text style={styles.emptyTitle}>No Announcements in this Scope</Text>
              <Text style={styles.emptyDesc}>
                Tap the "+ New Notice" button to display an announcement on the classroom digital board.
              </Text>
              <TouchableOpacity
                style={styles.emptyAddBtn}
                onPress={() => openNewModal('all')}
                activeOpacity={0.8}
              >
                <Ionicons name="add" size={16} color={isDark ? '#000000' : '#FFFFFF'} />
                <Text style={styles.emptyAddBtnText}>Post Announcement</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>

        {/* Bottom padding for floating navigation */}
        <View style={{ height: 130 }} />
      </ScrollView>

      {/* Creation Modal */}
      <NoticeModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        defaultClassroomId={defaultTarget}
      />
    </View>
  );
}

function getStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    headerAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: 10,
    },
    headerAddText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 12,
      fontWeight: '700',
    },
    scrollContent: {
      paddingHorizontal: Layout.spacing.md,
      paddingTop: 16,
    },
    hardwareBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 14,
    },
    hardwareLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    hardwareDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    hardwareTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    hardwareSub: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    actionsRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 16,
    },
    actionCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.card,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    actionIconBox: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionTitle: {
      color: colors.text,
      fontSize: 12,
      fontWeight: '700',
    },
    actionDesc: {
      color: colors.textMuted,
      fontSize: 10,
      marginTop: 1,
    },
    filterRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
    },
    filterPill: {
      paddingHorizontal: 14,
      paddingVertical: 7,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    filterPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    filterPillText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    filterPillTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontWeight: '700',
    },
    listSection: {
      marginBottom: 20,
    },
    listHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    listTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    listSubtitle: {
      color: colors.textMuted,
      fontSize: 11,
    },
    noticeCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 16,
      marginBottom: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    noticeTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    scopeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : colors.cardSecondary,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
    },
    scopeBadgeText: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
    },
    metaRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    durationBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 8,
    },
    durationText: {
      color: colors.textMuted,
      fontSize: 11,
    },
    deleteBtn: {
      padding: 2,
    },
    noticeTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
      marginBottom: 6,
      lineHeight: 22,
    },
    noticeMessage: {
      color: colors.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      marginBottom: 14,
    },
    noticeFooter: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
      paddingTop: 10,
    },
    timestampText: {
      color: colors.textMuted,
      fontSize: 11,
    },
    oledSyncBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    syncDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
      backgroundColor: colors.success,
    },
    syncText: {
      color: colors.success,
      fontSize: 10,
      fontWeight: '600',
    },
    emptyCard: {
      backgroundColor: colors.card,
      borderRadius: 14,
      padding: 28,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 8,
    },
    emptyTitle: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
      marginTop: 6,
    },
    emptyDesc: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
      lineHeight: 17,
    },
    emptyAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: 10,
      marginTop: 10,
    },
    emptyAddBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 12,
      fontWeight: '700',
    },
  });
}
