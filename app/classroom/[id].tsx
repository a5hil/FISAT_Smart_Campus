import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Colors } from '../../constants/colors';
import { Layout } from '../../constants/layout';
import { ScreenHeader } from '../../components/ScreenHeader';
import { DeviceCard } from '../../components/DeviceCard';
import { NoticeBoardCard } from '../../components/NoticeBoardCard';
import { FloatingBottomNav } from '../../components/FloatingBottomNav';
import { useApp, useTheme, sortDevicesDeterministically } from '../../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { triggerHaptic } from '../../utils/haptics';

export default function ClassroomDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { classrooms, toggleDevice, esp32Connected, esp32Ip } = useApp();
  const { colors, isDark } = useTheme();
  const router = useRouter();

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const classroom = classrooms.find(
    c => c.id === id || c.id === `cls-${id}` || c.number?.toLowerCase() === id?.toLowerCase()
  );

  if (!classroom) {
    return (
      <View style={styles.container}>
        <ScreenHeader title="Not Found" showBack />
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Classroom not found</Text>
        </View>
      </View>
    );
  }

  const isClassroom = Boolean(
    !classroom.id.toLowerCase().includes('corridor') &&
    !classroom.name.toLowerCase().includes('corridor') &&
    !classroom.name.toLowerCase().includes('hallway') &&
    classroom.capacity > 0
  );

  const isOffline = classroom.status === 'offline';
  const isOccupied = classroom.occupancy === 'occupied';
  const activeCount = classroom.devices.filter(d => d.status === 'on').length;
  const isEsp32Controlled = classroom.controller?.id === 'ctrl-esp32' || 
    classroom.id.includes('101') || 
    classroom.id.includes('102') || 
    classroom.id.includes('corr');

  return (
    <View style={styles.container}>
      <ScreenHeader 
        title={classroom.name} 
        showBack 
        rightElement={
          <TouchableOpacity 
            style={styles.iconButton}
            onPress={() => {
              triggerHaptic.light();
              router.push('/(tabs)/settings');
            }}
          >
            <Ionicons name="settings-outline" size={24} color={colors.text} />
          </TouchableOpacity>
        }
      />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <View style={styles.infoCardsRow}>
          <View style={styles.infoCard}>
            <View style={[styles.infoIcon, { backgroundColor: isOccupied ? (isDark ? 'rgba(76, 175, 80, 0.15)' : 'rgba(21, 128, 61, 0.12)') : (isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.05)') }]}>
              <Ionicons name="people" size={20} color={isOccupied ? colors.success : colors.textMuted} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Occupancy</Text>
              <Text style={styles.infoValue}>{isOccupied ? 'Occupied' : 'Vacant'}</Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <View style={[styles.infoIcon, { backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)' }]}>
              <Ionicons name="flash" size={20} color={colors.primary} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Current Load</Text>
              <Text style={styles.infoValue}>
                {classroom.currentLoad < 1000 ? `${classroom.currentLoad.toFixed(1)} W` : `${(classroom.currentLoad / 1000).toFixed(2)} kW`}
              </Text>
            </View>
          </View>
        </View>

        {/* Live Climate / DHT11 Sensors Row */}
        <View style={[styles.infoCardsRow, { marginTop: 10 }]}>
          <View style={styles.infoCard}>
            <View style={[styles.infoIcon, { backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(239, 68, 68, 0.12)' }]}>
              <Ionicons name="thermometer-outline" size={20} color={isDark ? '#F87171' : '#DC2626'} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Temperature</Text>
              <Text style={styles.infoValue}>{classroom.temperature}°C</Text>
            </View>
          </View>

          <View style={styles.infoCard}>
            <View style={[styles.infoIcon, { backgroundColor: isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(14, 165, 233, 0.12)' }]}>
              <Ionicons name="water-outline" size={20} color={isDark ? '#38BDF8' : '#0284C7'} />
            </View>
            <View>
              <Text style={styles.infoLabel}>Humidity</Text>
              <Text style={styles.infoValue}>{classroom.humidity !== undefined ? `${Math.round(classroom.humidity)}%` : '--%'}</Text>
            </View>
          </View>
        </View>

        {/* ESP32 Hardware Status Banner */}
        {isEsp32Controlled && (
          <View style={styles.hardwareBanner}>
            <View style={styles.hardwareLeft}>
              <View style={[styles.hardwareDot, { backgroundColor: esp32Connected ? colors.success : colors.warning }]} />
              <View>
                <Text style={styles.hardwareTitle}>ESP32 Controller ({esp32Connected ? 'Live' : 'Standby'})</Text>
                <Text style={styles.hardwareSubtitle}>Controlled via App • {esp32Ip || 'Auto-Detected'}</Text>
              </View>
            </View>
            <Ionicons name="hardware-chip-outline" size={20} color={colors.primary} />
          </View>
        )}

        {isOffline && !isEsp32Controlled && (
          <View style={styles.offlineBanner}>
            <Ionicons name="warning" size={24} color={colors.critical} />
            <View style={styles.offlineTextContainer}>
              <Text style={styles.offlineTitle}>Controller Offline</Text>
              <Text style={styles.offlineDesc}>Last seen: {new Date(classroom.controller.lastSeen).toLocaleTimeString()}</Text>
            </View>
          </View>
        )}

        {/* Real-time ACS712 & ZMPT101B Energy Meter (Exclusive to Classroom A101) */}
        {classroom.hasPowerMeter && (
          <View style={styles.meterCard}>
            <View style={styles.meterHeader}>
              <View style={styles.meterTitleRow}>
                <View style={styles.meterIconBox}>
                  <Ionicons name="speedometer-outline" size={20} color={colors.primary} />
                </View>
                <View>
                  <Text style={styles.meterTitle}>Real-Time Energy Meter</Text>
                  <Text style={styles.meterSubtitle}>Mains Line & Classroom Load</Text>
                </View>
              </View>
              <View style={styles.meterLiveTag}>
                <View style={[styles.hardwareDot, { backgroundColor: esp32Connected ? colors.success : colors.textMuted }]} />
                <Text style={[styles.meterLiveText, { color: esp32Connected ? colors.success : colors.textMuted }]}>
                  {esp32Connected ? 'LIVE MONITOR' : 'STANDBY'}
                </Text>
              </View>
            </View>

            <View style={styles.meterStatsGrid}>
              <View style={styles.meterStatBox}>
                <Text style={styles.meterStatLabel}>AC Voltage</Text>
                <Text style={styles.meterStatValue}>
                  {classroom.voltage !== undefined ? classroom.voltage.toFixed(1) : '0.0'}
                  <Text style={styles.meterStatUnit}> V</Text>
                </Text>
                <Text style={styles.meterStatSub}>Mains RMS</Text>
              </View>

              <View style={styles.meterStatBox}>
                <Text style={styles.meterStatLabel}>AC Current</Text>
                <Text style={styles.meterStatValue}>
                  {classroom.current !== undefined ? classroom.current.toFixed(2) : '0.00'}
                  <Text style={styles.meterStatUnit}> A</Text>
                </Text>
                <Text style={styles.meterStatSub}>Load RMS</Text>
              </View>

              <View style={styles.meterStatBox}>
                <Text style={styles.meterStatLabel}>Active Load</Text>
                <Text style={[styles.meterStatValue, { color: colors.primary }]}>
                  {classroom.currentLoad.toFixed(1)}
                  <Text style={styles.meterStatUnit}> W</Text>
                </Text>
                <Text style={styles.meterStatSub}>Real Power</Text>
              </View>
            </View>
          </View>
        )}

        {/* Classroom Digital Notice Board (Exclusively enabled for actual classrooms) */}
        {isClassroom && (
          <NoticeBoardCard
            filterClassroomId={classroom.id}
            classroomName={classroom.name}
          />
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Devices ({activeCount}/{classroom.devices.length} On)</Text>
        </View>

        <View style={styles.deviceGrid}>
          {sortDevicesDeterministically(classroom.devices || []).map(device => (
            <DeviceCard 
              key={device.id} 
              device={device}
              classroomId={classroom.id}
              onToggle={() => toggleDevice(classroom.id, device.id)} 
            />
          ))}
        </View>
        
        <View style={{ height: 100 }} />
      </ScrollView>

      <FloatingBottomNav activeTab="classrooms" />
    </View>
  );
}

function getStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    container: { 
      flex: 1, 
      backgroundColor: colors.background, 
    },
    iconButton: {
      padding: 8,
    },
    scrollContent: {
      padding: Layout.spacing.md,
    },
    emptyState: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
    },
    emptyTitle: {
      color: colors.text,
      fontSize: 18,
    },
    infoCardsRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 24,
    },
    infoCard: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 12,
    },
    infoIcon: {
      width: 40,
      height: 40,
      borderRadius: 20,
      justifyContent: 'center',
      alignItems: 'center',
    },
    infoLabel: {
      color: colors.textMuted,
      fontSize: 12,
      marginBottom: 2,
    },
    infoValue: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
    },
    offlineBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: 'rgba(255, 98, 95, 0.1)',
      borderWidth: 1,
      borderColor: 'rgba(255, 98, 95, 0.3)',
      padding: 16,
      borderRadius: Layout.radius.md,
      marginBottom: 24,
      gap: 12,
    },
    hardwareBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.08)' : 'rgba(217, 119, 6, 0.08)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.3)' : 'rgba(217, 119, 6, 0.25)',
      padding: 14,
      borderRadius: Layout.radius.md,
      marginBottom: 24,
    },
    hardwareLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flex: 1,
    },
    hardwareDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    hardwareTitle: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '700',
    },
    hardwareSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    offlineTextContainer: {
      flex: 1,
    },
    offlineTitle: {
      color: colors.critical,
      fontSize: 15,
      fontWeight: '600',
      marginBottom: 2,
    },
    offlineDesc: {
      color: colors.textMuted,
      fontSize: 13,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 16,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '600',
    },
    deviceGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'space-between',
    },
    meterCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.25)' : 'rgba(217, 119, 6, 0.25)',
      padding: 16,
      marginBottom: 24,
    },
    meterHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
      marginBottom: 14,
    },
    meterTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    meterIconBox: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      justifyContent: 'center',
      alignItems: 'center',
    },
    meterTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    meterSubtitle: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 1,
    },
    meterLiveTag: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 12,
      gap: 6,
    },
    meterLiveText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    meterStatsGrid: {
      flexDirection: 'row',
      gap: 10,
    },
    meterStatBox: {
      flex: 1,
      backgroundColor: isDark ? 'rgba(0, 0, 0, 0.25)' : colors.cardSecondary,
      borderRadius: Layout.radius.md,
      padding: 12,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    meterStatLabel: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '500',
      marginBottom: 4,
      textAlign: 'center',
    },
    meterStatValue: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '800',
    },
    meterStatUnit: {
      fontSize: 12,
      fontWeight: '500',
      color: colors.textMuted,
    },
    meterStatSub: {
      color: colors.textMuted,
      fontSize: 10,
      marginTop: 2,
      opacity: 0.7,
    },
  });
}
