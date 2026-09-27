import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Dimensions } from 'react-native';
import { Colors } from '../../constants/colors';
import { Layout } from '../../constants/layout';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useApp, useTheme } from '../../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { EnergyReading } from '../../types';

type Period = 'hourly' | 'daily' | 'weekly';
const screenWidth = Dimensions.get('window').width;

function BarChart({ data, period, colors }: { data: EnergyReading[]; period: Period; colors: any }) {
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barWidth = period === 'hourly' ? 8 : period === 'daily' ? 28 : 40;
  const chartHeight = 160;

  return (
    <View style={chartStyles.container}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={chartStyles.scrollContent}>
        {data.map((d, i) => {
          const barHeight = (d.value / maxVal) * chartHeight;
          return (
            <View key={i} style={[chartStyles.barContainer, { width: barWidth + 8 }]}>
              <Text style={[chartStyles.valueText, { color: colors.textMuted }]}>
                {d.value < 10 ? d.value.toFixed(1) : Math.round(d.value)}
              </Text>
              <View style={[chartStyles.bar, { height: Math.max(barHeight, 4), width: barWidth, backgroundColor: colors.primary }]} />
              <Text style={[chartStyles.labelText, { color: colors.textMuted }]} numberOfLines={1}>
                {d.time}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const chartStyles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  scrollContent: {
    alignItems: 'flex-end',
    paddingHorizontal: 4,
    paddingBottom: 24,
    minHeight: 220,
  },
  barContainer: {
    alignItems: 'center',
    justifyContent: 'flex-end',
    marginHorizontal: 2,
  },
  valueText: {
    fontSize: 9,
    marginBottom: 4,
  },
  bar: {
    borderRadius: 4,
    minWidth: 4,
  },
  labelText: {
    fontSize: 10,
    marginTop: 6,
    width: '100%',
    textAlign: 'center',
  },
});

export default function EnergyScreen() {
  const { energyData, classrooms } = useApp();
  const { colors, isDark } = useTheme();
  const [period, setPeriod] = useState<Period>('hourly');

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const totalToday = classrooms.reduce((sum, c) => sum + c.energyToday, 0);
  const totalCost = classrooms.reduce((sum, c) => sum + c.estimatedCost, 0);
  const currentLoad = classrooms.reduce((sum, c) => sum + c.currentLoad, 0);

  // Dynamically build daily & weekly metrics from real accumulated consumption
  const todayIndex = (new Date().getDay() + 6) % 7; // 0=Mon, 6=Sun
  const daysLabels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dynamicDaily: EnergyReading[] = daysLabels.map((day, idx) => ({
    time: day,
    value: idx === todayIndex ? Number(totalToday.toFixed(3)) : (energyData.daily[idx]?.value || 0),
  }));

  const dynamicWeekly: EnergyReading[] = [
    { time: 'Wk 1', value: 0 },
    { time: 'Wk 2', value: 0 },
    { time: 'Wk 3', value: 0 },
    { time: 'Current', value: Number(totalToday.toFixed(3)) },
  ];

  const data = period === 'hourly' ? energyData.hourly : period === 'daily' ? dynamicDaily : dynamicWeekly;

  // Rankings by energy consumption
  const rankedClassrooms = [...classrooms].sort((a, b) => b.energyToday - a.energyToday);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Energy" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Overview Cards */}
        <View style={styles.overviewRow}>
          <View style={[styles.overviewCard, { backgroundColor: colors.primary }]}>
            <Ionicons name="flash" size={24} color={isDark ? '#000000' : '#FFFFFF'} />
            <Text style={[styles.overviewValue, { color: isDark ? '#000000' : '#FFFFFF' }]}>
              {totalToday < 1 ? totalToday.toFixed(3) : totalToday.toFixed(2)}
            </Text>
            <Text style={[styles.overviewLabel, { color: isDark ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.85)' }]}>kWh Today</Text>
          </View>
          <View style={styles.overviewCard}>
            <Ionicons name="cash-outline" size={24} color={colors.success} />
            <Text style={[styles.overviewValue, { color: colors.text }]}>₹{totalCost.toFixed(1)}</Text>
            <Text style={[styles.overviewLabel, { color: colors.textMuted }]}>Est. Cost</Text>
          </View>
          <View style={styles.overviewCard}>
            <Ionicons name="power" size={24} color={colors.primary} />
            <Text style={[styles.overviewValue, { color: colors.text }]}>{(currentLoad / 1000).toFixed(2)}</Text>
            <Text style={[styles.overviewLabel, { color: colors.textMuted }]}>kW Now</Text>
          </View>
        </View>

        {/* Chart Section */}
        <View style={styles.chartCard}>
          <View style={styles.chartHeader}>
            <Text style={styles.chartTitle}>Consumption</Text>
            <View style={styles.periodSelector}>
              {(['hourly', 'daily', 'weekly'] as Period[]).map(p => (
                <TouchableOpacity
                  key={p}
                  style={[styles.periodChip, period === p && styles.periodChipActive]}
                  onPress={() => setPeriod(p)}
                >
                  <Text style={[styles.periodText, period === p && styles.periodTextActive]}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <BarChart data={data} period={period} colors={colors} />
        </View>

        {/* Rankings */}
        <View style={styles.rankingsSection}>
          <Text style={styles.sectionTitle}>Classroom Rankings</Text>
          <Text style={styles.sectionSubtitle}>Sorted by today's consumption</Text>
          
          {rankedClassrooms.map((cls, index) => (
            <View key={cls.id} style={styles.rankRow}>
              <View style={styles.rankLeft}>
                <View style={[
                  styles.rankBadge, 
                  index === 0 && { backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)' },
                  index === 1 && { backgroundColor: isDark ? 'rgba(192, 192, 192, 0.15)' : 'rgba(100, 116, 139, 0.12)' },
                  index === 2 && { backgroundColor: isDark ? 'rgba(205, 127, 50, 0.15)' : 'rgba(180, 83, 9, 0.12)' },
                ]}>
                  <Text style={[
                    styles.rankNumber,
                    index === 0 && { color: colors.primary },
                  ]}>#{index + 1}</Text>
                </View>
                <View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={styles.rankName}>{cls.name}</Text>
                    {cls.hasPowerMeter && (
                      <View style={{ backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 }}>
                        <Text style={{ color: colors.primary, fontSize: 9, fontWeight: '700' }}>RMS METER</Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.rankSub}>
                    {cls.devices.filter(d => d.status === 'on').length} devices active • {cls.currentLoad.toFixed(0)}W
                  </Text>
                </View>
              </View>
              <View style={styles.rankRight}>
                <Text style={styles.rankEnergy}>
                  {cls.energyToday < 1 ? cls.energyToday.toFixed(3) : cls.energyToday.toFixed(2)} kWh
                </Text>
                <Text style={styles.rankCost}>₹{cls.estimatedCost.toFixed(2)}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={{ height: 120 }} />
      </ScrollView>
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
    overviewRow: {
      flexDirection: 'row',
      gap: 12,
      marginBottom: 24,
    },
    overviewCard: {
      flex: 1,
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    overviewValue: {
      fontSize: 22,
      fontWeight: '800',
      marginTop: 8,
    },
    overviewLabel: {
      fontSize: 12,
      fontWeight: '500',
      marginTop: 2,
    },
    chartCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 24,
    },
    chartHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    chartTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    periodSelector: {
      flexDirection: 'row',
      gap: 4,
    },
    periodChip: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      borderRadius: Layout.radius.round,
    },
    periodChipActive: {
      backgroundColor: colors.primary,
    },
    periodText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    periodTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
    },
    rankingsSection: {
      marginBottom: 24,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 4,
    },
    sectionSubtitle: {
      color: colors.textMuted,
      fontSize: 13,
      marginBottom: 16,
    },
    rankRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      backgroundColor: colors.card,
      padding: 14,
      borderRadius: Layout.radius.md,
      marginBottom: 8,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    rankLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      flex: 1,
    },
    rankBadge: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      justifyContent: 'center',
      alignItems: 'center',
      marginRight: 12,
    },
    rankNumber: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    rankName: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 2,
    },
    rankSub: {
      color: colors.textMuted,
      fontSize: 12,
    },
    rankRight: {
      alignItems: 'flex-end',
    },
    rankEnergy: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 2,
    },
    rankCost: {
      color: colors.textMuted,
      fontSize: 12,
    },
  });
}
