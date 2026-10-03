import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Classroom } from '../types';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useApp } from '../context/AppContext';
import { triggerHaptic } from '../utils/haptics';

interface ClassroomCardProps {
  classroom: Classroom;
}

export function ClassroomCard({ classroom }: ClassroomCardProps) {
  const { colors, isDark } = useApp();
  const router = useRouter();
  
  const activeDevices = classroom.devices.filter(d => d.status === 'on').length;
  const isOffline = classroom.status === 'offline';
  const isOccupied = classroom.occupancy === 'occupied';

  return (
    <TouchableOpacity 
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.surfaceBorder }]}
      activeOpacity={0.7}
      onPress={() => {
        triggerHaptic.light();
        router.push(`/classroom/${classroom.id}`);
      }}
    >
      <View style={styles.header}>
        <View style={styles.titleContainer}>
          <Text style={[styles.title, { color: colors.text }]}>{classroom.name}</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>{classroom.building} • {classroom.floor}</Text>
        </View>
        <View style={styles.statusBadges}>
          {isOffline ? (
            <View style={[styles.badge, { backgroundColor: colors.criticalSubtle }]}>
              <View style={[styles.dot, { backgroundColor: colors.critical }]} />
              <Text style={[styles.badgeText, { color: colors.critical }]}>Offline</Text>
            </View>
          ) : (
            <View style={[styles.badge, { backgroundColor: isOccupied ? colors.successSubtle : colors.badgeBackground }]}>
              <View style={[styles.dot, { backgroundColor: isOccupied ? colors.success : colors.textMuted }]} />
              <Text style={[styles.badgeText, { color: isOccupied ? colors.success : colors.textMuted }]}>
                {isOccupied ? 'Occupied' : 'Vacant'}
              </Text>
            </View>
          )}
        </View>
      </View>

      <View style={[styles.statsRow, { borderTopColor: colors.surfaceBorder }]}>
        <View style={styles.stat}>
          <Ionicons name="radio-button-on" size={15} color={activeDevices > 0 ? colors.primary : colors.textMuted} />
          <Text style={[styles.statText, { color: colors.textSecondary }]}>{activeDevices} Active</Text>
        </View>
        <View style={styles.stat}>
          <Ionicons name="thermometer-outline" size={15} color={colors.textMuted} />
          <Text style={[styles.statText, { color: colors.textSecondary }]}>{classroom.temperature}°C</Text>
        </View>
        <View style={styles.stat}>
          <Ionicons name="water-outline" size={15} color="#38BDF8" />
          <Text style={[styles.statText, { color: colors.textSecondary }]}>
            {classroom.humidity !== undefined ? `${Math.round(classroom.humidity)}%` : '--%'}
          </Text>
        </View>
        <View style={styles.stat}>
          <Ionicons name="flash-outline" size={15} color={classroom.currentLoad > 0 ? (isDark ? '#F59E0B' : '#D97706') : colors.textMuted} />
          <Text style={[styles.statText, { color: colors.textSecondary }]}>
            {classroom.currentLoad < 1000 ? `${classroom.currentLoad.toFixed(0)} W` : `${(classroom.currentLoad / 1000).toFixed(1)} kW`}
          </Text>
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  titleContainer: {
    flex: 1,
    marginRight: 12,
  },
  title: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 4,
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  statusBadges: {
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 8,
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Layout.radius.round,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  statsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: Colors.surfaceTranslucent,
  },
  stat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  statText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
});
