import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { useApp } from '../context/AppContext';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { triggerHaptic } from '../utils/haptics';

export function HomeHeader() {
  const { user, campus, notifications, colors } = useApp();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const unreadCount = notifications.filter(n => !n.isRead).length;

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, 16), backgroundColor: colors.background }]}>
      <View style={styles.left}>
        <View style={[styles.avatarContainer, { backgroundColor: colors.card, borderColor: colors.surfaceBorder }]}>
          <Text style={[styles.avatarText, { color: colors.primary }]}>{user.initials}</Text>
        </View>
        <View style={styles.textContainer}>
          <Text style={[styles.greeting, { color: colors.text }]}>Hello, {user.name.split(' ')[0]}</Text>
          <View style={styles.campusRow}>
            <Ionicons name="location" size={14} color={colors.textMuted} />
            <Text style={[styles.campusName, { color: colors.textSecondary }]}>{campus.name} • {campus.department}</Text>
          </View>
        </View>
      </View>
      
      <TouchableOpacity 
        style={[styles.bellButton, { backgroundColor: colors.card, borderColor: colors.surfaceBorder }]}
        onPress={() => {
          triggerHaptic.light();
          router.push('/notifications');
        }}
      >
        <Ionicons name="notifications-outline" size={24} color={colors.text} />
        {unreadCount > 0 && (
          <View style={[styles.badge, { borderColor: colors.background }]}>
            <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: Layout.spacing.md,
    paddingBottom: 16,
  },
  left: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarContainer: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
    borderWidth: 1,
  },
  avatarText: {
    fontSize: 16,
    fontWeight: '700',
  },
  textContainer: {
    justifyContent: 'center',
  },
  greeting: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 2,
  },
  campusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  campusName: {
    fontSize: 13,
  },
  bellButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
  },
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    backgroundColor: '#FF625F',
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 4,
    borderWidth: 2,
  },
  badgeText: {
    color: '#FFF',
    fontSize: 10,
    fontWeight: 'bold',
  },
});
