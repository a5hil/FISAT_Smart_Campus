import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';
import { useRouter } from 'expo-router';

export function EnergyOverviewCard() {
  const { classrooms, colors, isDark } = useApp();
  const router = useRouter();

  // Calculate totals
  let totalEnergy = 0;
  let totalLoad = 0;
  let activeDevices = 0;
  
  classrooms.forEach(cls => {
    totalEnergy += cls.energyToday;
    totalLoad += cls.currentLoad;
    activeDevices += cls.devices.filter(d => d.status === 'on').length;
  });

  const mainCardTextColor = isDark ? '#000000' : '#FFFFFF';

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={[styles.mainCard, { backgroundColor: colors.primary }]} 
        activeOpacity={0.8}
        onPress={() => router.push('/energy')}
      >
        <View style={styles.cardHeader}>
          <View style={[styles.iconContainer, { backgroundColor: isDark ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.2)' }]}>
            <Ionicons name="flash" size={20} color={mainCardTextColor} />
          </View>
          <Text style={[styles.cardTitle, { color: mainCardTextColor }]}>Today's Energy</Text>
        </View>
        <View style={styles.cardBody}>
          <Text style={[styles.energyValue, { color: mainCardTextColor }]}>
            {totalEnergy < 1 ? totalEnergy.toFixed(3) : totalEnergy.toFixed(2)}
          </Text>
          <Text style={[styles.energyUnit, { color: mainCardTextColor }]}>kWh</Text>
        </View>
        <View style={styles.cardFooter}>
          <Ionicons name="hardware-chip-outline" size={15} color={mainCardTextColor} />
          <Text style={[styles.footerText, { color: mainCardTextColor }]}>Live hardware telemetry</Text>
        </View>
      </TouchableOpacity>

      <View style={styles.sideCards}>
        <View style={[styles.sideCard, { backgroundColor: colors.card, borderColor: colors.surfaceBorder }]}>
          <View style={[styles.iconContainerSide, { backgroundColor: colors.primarySubtle }]}>
            <Ionicons name="power" size={16} color={colors.primary} />
          </View>
          <View style={styles.sideCardTextContainer}>
            <Text style={[styles.sideCardLabel, { color: colors.textSecondary }]}>Current Load</Text>
            <Text style={[styles.sideCardValue, { color: colors.text }]}>
              {totalLoad < 1000 ? `${totalLoad.toFixed(0)} W` : `${(totalLoad / 1000).toFixed(2)} kW`}
            </Text>
          </View>
        </View>

        <View style={[styles.sideCard, { backgroundColor: colors.card, borderColor: colors.surfaceBorder }]}>
          <View style={[styles.iconContainerSide, { backgroundColor: colors.successSubtle }]}>
            <Ionicons name="radio-button-on" size={16} color={colors.success} />
          </View>
          <View style={styles.sideCardTextContainer}>
            <Text style={[styles.sideCardLabel, { color: colors.textSecondary }]}>Active Devices</Text>
            <Text style={[styles.sideCardValue, { color: colors.text }]}>{activeDevices}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: Layout.spacing.md,
    gap: 12,
    marginBottom: 24,
  },
  mainCard: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Layout.radius.lg,
    padding: 16,
    justifyContent: 'space-between',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  iconContainer: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.1)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  cardTitle: {
    color: '#000',
    fontSize: 14,
    fontWeight: '600',
    opacity: 0.8,
  },
  cardBody: {
    flexDirection: 'row',
    alignItems: 'baseline',
    marginBottom: 16,
  },
  energyValue: {
    color: '#000',
    fontSize: 36,
    fontWeight: '800',
    letterSpacing: -1,
  },
  energyUnit: {
    color: '#000',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 4,
    opacity: 0.8,
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  footerText: {
    color: 'rgba(0,0,0,0.6)',
    fontSize: 12,
    fontWeight: '500',
  },
  sideCards: {
    flex: 0.8,
    justifyContent: 'space-between',
    gap: 12,
  },
  sideCard: {
    flex: 1,
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    padding: 12,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
  },
  iconContainerSide: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  sideCardTextContainer: {
    justifyContent: 'flex-end',
  },
  sideCardLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    marginBottom: 2,
  },
  sideCardValue: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
});
