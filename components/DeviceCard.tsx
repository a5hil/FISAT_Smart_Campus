import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Switch, Platform } from 'react-native';
import { Device } from '../types';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';

import { useApp } from '../context/AppContext';

interface DeviceCardProps {
  device: Device;
  classroomId?: string;
  onToggle: () => void;
}

export function DeviceCard({ device, classroomId, onToggle }: DeviceCardProps) {
  const { colors, isDark } = useApp();
  const router = useRouter();
  const isOn = device.status === 'on';
  const isOffline = device.status === 'offline';
  const isCurtain = device.category === 'curtain';

  const targetClassroomId = classroomId || (
    device.id.includes('a101') ? 'cls-a101' :
    device.id.includes('a102') ? 'cls-a102' :
    'cls-corridor'
  );

  const navigateToDetails = () => {
    router.push({ 
      pathname: '/device/[id]', 
      params: { id: device.id, classroomId: targetClassroomId } 
    });
  };

  const handleTilePress = () => {
    if (!isOffline) {
      onToggle();
    }
  };

  const getIcon = () => {
    if (device.id.includes('notice') || device.name.toLowerCase().includes('notice')) return 'easel-outline';
    if (device.id.includes('screen') || device.name.toLowerCase().includes('screen')) return 'desktop-outline';
    switch (device.category) {
      case 'light': return 'bulb';
      case 'fan': return 'hardware-chip';
      case 'curtain': return 'apps';
      case 'smart-board':
      case 'display': return 'tv-outline';
      default: return 'power';
    }
  };

  const getStatusText = () => {
    if (isOffline) return 'Offline';
    if (isCurtain) return isOn ? 'Open (90°)' : 'Closed';
    const isDisplay = device.id.includes('notice') || device.id.includes('screen') || device.category === 'smart-board' || device.category === 'display';
    if (isDisplay) {
      return isOn ? 'Active • Display ON' : 'Standby • Display OFF';
    }
    const rating = device.ratedPower || (device.category === 'fan' ? 75 : device.category === 'light' ? 60 : 40);
    return isOn ? `On • ${device.powerUsage || rating}W` : `Off • ${rating}W`;
  };

  return (
    <TouchableOpacity 
      style={[
        styles.card,
        {
          backgroundColor: isOn && !isOffline ? colors.primarySubtle : colors.card,
          borderColor: isOn && !isOffline ? colors.primary : colors.surfaceBorder,
        },
        isOffline && styles.cardOffline
      ]}
      activeOpacity={0.75}
      onPress={handleTilePress}
      onLongPress={navigateToDetails}
      delayLongPress={350}
    >
      <View style={styles.header}>
        <View style={[
          styles.iconContainer,
          {
            backgroundColor: isOn && !isOffline
              ? colors.primarySubtle
              : (isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)'),
          },
        ]}>
          <Ionicons 
            name={getIcon() as any} 
            size={20} 
            color={isOffline ? colors.textMuted : isOn ? colors.primary : colors.text} 
          />
        </View>

        <View style={styles.switchWrapper}>
          <Switch
            value={isOn}
            onValueChange={handleTilePress}
            disabled={isOffline}
            trackColor={{ false: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)', true: colors.primary }}
            thumbColor={isOn ? '#FFFFFF' : (isDark ? '#D1D5DB' : '#FFFFFF')}
            style={{ 
              transform: [{ scale: Platform.OS === 'ios' ? 0.95 : 1.15 }] 
            }}
            pointerEvents="none"
          />
        </View>
      </View>

      <View style={styles.footer}>
        <View style={styles.info}>
          <Text style={[styles.name, { color: isOffline ? colors.textMuted : colors.text }]} numberOfLines={1}>
            {device.name}
          </Text>
          <Text style={[styles.status, { color: colors.textSecondary }]}>
            {getStatusText()}
          </Text>
        </View>

        <TouchableOpacity
          style={[
            styles.settingsButton,
            {
              backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.04)',
              borderColor: colors.surfaceBorder,
            },
            isOn && !isOffline && { borderColor: colors.primary, backgroundColor: colors.primarySubtle }
          ]}
          onPress={(e) => {
            e.stopPropagation?.();
            navigateToDetails();
          }}
          hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
          accessibilityLabel="Device Details"
        >
          <Ionicons 
            name="settings-outline" 
            size={14} 
            color={isOn && !isOffline ? colors.primary : colors.textMuted} 
          />
        </TouchableOpacity>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%', // Allows 2 cards per row with gap
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
    marginBottom: 16,
  },
  cardActive: {
    borderColor: 'rgba(253, 168, 58, 0.45)',
    backgroundColor: 'rgba(253, 168, 58, 0.08)',
  },
  cardOffline: {
    opacity: 0.6,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  iconContainer: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: Colors.surfaceTranslucent,
    justifyContent: 'center',
    alignItems: 'center',
  },
  iconContainerActive: {
    backgroundColor: 'rgba(253, 168, 58, 0.18)',
  },
  iconContainerOffline: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
  },
  info: {
    flex: 1,
    marginRight: 6,
    gap: 3,
  },
  name: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  textOffline: {
    color: Colors.textMuted,
  },
  status: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  switchWrapper: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingRight: 2,
  },
  settingsButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  settingsButtonActive: {
    backgroundColor: 'rgba(253, 168, 58, 0.12)',
    borderColor: 'rgba(253, 168, 58, 0.3)',
  },
});
