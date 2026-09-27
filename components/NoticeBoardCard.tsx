import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert as RNAlert,
  Platform,
} from 'react-native';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { NoticeItem } from '../types';
import { useApp, useTheme } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { NoticeModal } from './NoticeModal';

import { useRouter } from 'expo-router';

interface NoticeBoardCardProps {
  filterClassroomId?: string; // Optional: restrict to a specific classroom + 'all'
  classroomName?: string;
  isHomeScreen?: boolean;
}

export function NoticeBoardCard({
  filterClassroomId,
  classroomName,
  isHomeScreen = false,
}: NoticeBoardCardProps) {
  const router = useRouter();
  const { notices, deleteNotice, esp32Connected } = useApp();
  const { colors, isDark } = useTheme();
  const [modalVisible, setModalVisible] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  // Digital notice board is exclusively for classrooms, not corridors/hallways
  const isCorridorArea = Boolean(
    (filterClassroomId && (filterClassroomId.toLowerCase().includes('corridor') || filterClassroomId.toLowerCase().includes('hallway'))) ||
    (classroomName && (classroomName.toLowerCase().includes('corridor') || classroomName.toLowerCase().includes('hallway')))
  );

  if (isCorridorArea) {
    return null;
  }

  // Filter notices relevant to this context
  const filteredNotices = notices.filter((n) => {
    if (!filterClassroomId || filterClassroomId === 'all') return true;
    return n.classroomId === filterClassroomId || n.classroomId === 'all';
  });

  // 20-second automatic carousel rotation when multiple notices exist
  useEffect(() => {
    if (filteredNotices.length <= 1) {
      setCurrentIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % filteredNotices.length);
    }, 20000); // 20s rotation

    return () => clearInterval(interval);
  }, [filteredNotices.length]);

  const activeNotice: NoticeItem | undefined = filteredNotices[currentIndex];

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

  return (
    <View style={styles.cardContainer}>
      {/* Header */}
      <View style={styles.cardHeader}>
        <View style={styles.headerTitleRow}>
          <View style={styles.headerIconBox}>
            <Ionicons
              name={isHomeScreen ? 'megaphone-outline' : 'easel-outline'}
              size={18}
              color={colors.primary}
            />
          </View>
          <View style={styles.headerTextCol}>
            <Text style={styles.cardTitle} numberOfLines={1}>
              {isHomeScreen ? 'Campus Notice Board' : 'Digital Notice Board'}
            </Text>
            <View style={styles.headerSubRow}>
              <View style={[styles.statusTag, { backgroundColor: esp32Connected ? 'rgba(73, 199, 121, 0.15)' : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)') }]}>
                <View style={[styles.statusDot, { backgroundColor: esp32Connected ? colors.success : colors.textMuted }]} />
                <Text style={[styles.statusText, { color: esp32Connected ? colors.success : colors.textMuted }]}>
                  {esp32Connected ? 'Board Live' : 'Standby'}
                </Text>
              </View>
              <Text style={styles.cardSubtitle} numberOfLines={1}>
                {isHomeScreen ? '• Broadcast' : `• ${filteredNotices.length} active`}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.headerButtonsRow}>
          <TouchableOpacity
            style={styles.viewAllMiniButton}
            onPress={() => router.push('/announcements')}
            activeOpacity={0.7}
          >
            <Text style={styles.viewAllMiniText}>View All</Text>
            <Ionicons name="chevron-forward" size={13} color={colors.primary} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.newNoticeButton}
            onPress={() => setModalVisible(true)}
            activeOpacity={0.8}
          >
            <Ionicons name="add" size={15} color={isDark ? '#000000' : '#FFFFFF'} />
            <Text style={styles.newNoticeButtonText}>New</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Content Area - FIXED HEIGHT CONTAINER */}
      {filteredNotices.length > 0 && activeNotice ? (
        <View style={styles.activeNoticeCard}>
          {/* Top metadata row */}
          <View style={styles.noticeMetaRow}>
            <View style={styles.scopeBadge}>
              <Ionicons
                name={activeNotice.classroomId === 'all' ? 'megaphone' : 'business'}
                size={11}
                color={activeNotice.classroomId === 'all' ? colors.primary : colors.textSecondary}
              />
              <Text
                style={[
                  styles.scopeBadgeText,
                  activeNotice.classroomId === 'all' && { color: colors.primary },
                ]}
                numberOfLines={1}
                ellipsizeMode="tail"
              >
                {activeNotice.classroomId === 'all' ? 'Broadcast' : (activeNotice.classroomName || 'Classroom')}
              </Text>
            </View>

            <View style={styles.metaRight}>
              <View style={styles.durationBadge}>
                <Ionicons name="time-outline" size={11} color={colors.textMuted} />
                <Text style={styles.durationBadgeText}>{formatExpiry(activeNotice)}</Text>
              </View>
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleDelete(activeNotice.id, activeNotice.title)}
                hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                activeOpacity={0.6}
              >
                <Ionicons name="trash-outline" size={15} color={colors.critical} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Title and Message: Clickable to view details */}
          <TouchableOpacity
            style={styles.textContainer}
            activeOpacity={0.85}
            onPress={() => router.push('/announcements')}
          >
            <Text style={styles.noticeTitle} numberOfLines={1} ellipsizeMode="tail">
              {activeNotice.title}
            </Text>
            <Text style={styles.noticeMessage} numberOfLines={2} ellipsizeMode="tail">
              {activeNotice.message}
            </Text>
          </TouchableOpacity>

          {/* Carousel footer & pagination */}
          <View style={styles.carouselFooter}>
            <Text style={styles.timestampText}>
              Posted {new Date(activeNotice.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </Text>

            {filteredNotices.length > 1 ? (
              <View style={styles.paginationRow}>
                <Text style={styles.carouselCounterText}>
                  {currentIndex + 1}/{filteredNotices.length}
                </Text>
                <View style={styles.dotsRow}>
                  {filteredNotices.map((_, idx) => (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => setCurrentIndex(idx)}
                      style={[
                        styles.dot,
                        idx === currentIndex ? styles.dotActive : styles.dotInactive,
                      ]}
                    />
                  ))}
                </View>
              </View>
            ) : (
              <View style={styles.tapToViewRow}>
                <Text style={styles.tapToViewText}>Tap to view details</Text>
                <Ionicons name="chevron-forward" size={12} color={colors.textMuted} />
              </View>
            )}
          </View>
        </View>
      ) : (
        <View style={styles.emptyContainer}>
          <Ionicons name="notifications-off-outline" size={24} color={colors.textMuted} />
          <Text style={styles.emptyTitle}>No Active Announcements</Text>
          <Text style={styles.emptyDesc} numberOfLines={2} ellipsizeMode="tail">
            {isHomeScreen
              ? 'Tap "New" above to post an announcement to all classroom displays.'
              : 'Post an announcement to display on this classroom\'s digital board.'}
          </Text>
        </View>
      )}

      {/* Notice Creation Modal */}
      <NoticeModal
        visible={modalVisible}
        onClose={() => setModalVisible(false)}
        defaultClassroomId={filterClassroomId || 'all'}
        defaultClassroomName={classroomName}
      />
    </View>
  );
}

function getStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    cardContainer: {
      backgroundColor: colors.card,
      borderRadius: 16,
      padding: 16,
      marginBottom: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    cardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 14,
      gap: 8,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
      minWidth: 0,
    },
    headerIconBox: {
      width: 36,
      height: 36,
      borderRadius: 10,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    headerTextCol: {
      flex: 1,
      minWidth: 0,
    },
    cardTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    headerSubRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 3,
    },
    cardSubtitle: {
      color: colors.textMuted,
      fontSize: 11,
      flexShrink: 1,
    },
    statusTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: 8,
      flexShrink: 0,
    },
    statusDot: {
      width: 5,
      height: 5,
      borderRadius: 3,
    },
    statusText: {
      fontSize: 10,
      fontWeight: '600',
    },
    headerButtonsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    viewAllMiniButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.12)' : 'rgba(217, 119, 6, 0.1)',
      paddingHorizontal: 8,
      paddingVertical: 7,
      borderRadius: 9,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.25)' : 'rgba(217, 119, 6, 0.25)',
    },
    viewAllMiniText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    newNoticeButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: colors.primary,
      paddingHorizontal: 10,
      paddingVertical: 7,
      borderRadius: 9,
      flexShrink: 0,
    },
    newNoticeButtonText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
    },
    activeNoticeCard: {
      backgroundColor: isDark ? '#111111' : colors.cardSecondary,
      borderRadius: 12,
      padding: 12,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.25)' : 'rgba(217, 119, 6, 0.25)',
      height: 146,
      justifyContent: 'space-between',
    },
    noticeMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    scopeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
      paddingHorizontal: 7,
      paddingVertical: 3,
      borderRadius: 7,
    },
    scopeBadgeText: {
      color: colors.textSecondary,
      fontSize: 11,
      fontWeight: '600',
    },
    metaRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    durationBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: 7,
    },
    durationBadgeText: {
      color: colors.textMuted,
      fontSize: 10,
    },
    deleteButton: {
      padding: 4,
    },
    textContainer: {
      flex: 1,
      justifyContent: 'center',
      marginVertical: 2,
    },
    noticeTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
      marginBottom: 3,
      lineHeight: 18,
    },
    noticeMessage: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
    },
    carouselFooter: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
      paddingTop: 6,
    },
    timestampText: {
      color: colors.textMuted,
      fontSize: 10,
    },
    tapToViewRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
    },
    tapToViewText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
    },
    paginationRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    carouselCounterText: {
      color: colors.primary,
      fontSize: 10,
      fontWeight: '600',
    },
    dotsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    dot: {
      height: 4,
      borderRadius: 2,
    },
    dotActive: {
      width: 12,
      backgroundColor: colors.primary,
    },
    dotInactive: {
      width: 4,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.2)' : 'rgba(0, 0, 0, 0.15)',
    },
    emptyContainer: {
      height: 146,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.02)' : 'rgba(0, 0, 0, 0.02)',
      borderRadius: 12,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 6,
      paddingHorizontal: 20,
    },
    emptyTitle: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      marginTop: 4,
    },
    emptyDesc: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
      paddingHorizontal: 24,
      lineHeight: 16,
    },
  });
}
