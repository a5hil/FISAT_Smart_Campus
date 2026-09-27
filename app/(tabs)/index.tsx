import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Colors } from '../../constants/colors';
import { Layout } from '../../constants/layout';
import { HomeHeader } from '../../components/HomeHeader';
import { EnergyOverviewCard } from '../../components/EnergyOverviewCard';
import { QuickControls } from '../../components/QuickControls';
import { Esp32LiveBar } from '../../components/Esp32LiveBar';
import { ClassroomCard } from '../../components/ClassroomCard';
import { NoticeBoardCard } from '../../components/NoticeBoardCard';
import { useApp } from '../../context/AppContext';
import { useRouter } from 'expo-router';

import { Ionicons } from '@expo/vector-icons';

export default function HomeScreen() {
  const { classrooms, timetable } = useApp();
  const router = useRouter();

  // Determine current active period
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const activePeriod = timetable.enabled
    ? timetable.periods.find(p => {
        if (!p.enabled) return false;
        const [sh, sm] = p.startTime.split(':').map(Number);
        const [eh, em] = p.endTime.split(':').map(Number);
        return currentMinutes >= sh * 60 + sm && currentMinutes < eh * 60 + em;
      })
    : null;

  return (
    <View style={styles.container}>
      <HomeHeader />
      
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <EnergyOverviewCard />
        
        <Esp32LiveBar />

        {/* Timetable / Period Bell Quick Banner */}
        <View style={styles.periodBannerContainer}>
          <TouchableOpacity 
            style={styles.periodBanner} 
            activeOpacity={0.8}
            onPress={() => router.push('/timetable')}
          >
            <View style={styles.periodBannerLeft}>
              <View style={[styles.periodDot, { backgroundColor: activePeriod ? Colors.success : Colors.primary }]} />
              <Ionicons name={activePeriod ? "notifications" : "calendar-outline"} size={16} color={activePeriod ? Colors.primary : Colors.textMuted} />
              <Text style={styles.periodBannerText} numberOfLines={1}>
                {activePeriod 
                  ? `Active: ${activePeriod.name} (${activePeriod.startTime} - ${activePeriod.endTime})` 
                  : `Period Bell: ${timetable.enabled ? `${timetable.periods.filter(p => p.enabled).length} Periods Active` : 'Disabled'}`}
              </Text>
            </View>
            <Text style={styles.periodBannerAction}>Timetable →</Text>
          </TouchableOpacity>
        </View>

        {/* Campus Digital Notice Board (Broadcast to all classrooms) */}
        <View style={styles.noticeSection}>
          <NoticeBoardCard isHomeScreen={true} />
        </View>
        
        <QuickControls />

        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Smart Classrooms & Zones</Text>
            <TouchableOpacity onPress={() => router.push('/classrooms')}>
              <Text style={styles.seeAll}>View All</Text>
            </TouchableOpacity>
          </View>
          {classrooms.map(cls => (
            <ClassroomCard key={cls.id} classroom={cls} />
          ))}
        </View>

        {/* Bottom padding for floating navigation */}
        <View style={{ height: 120 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    paddingTop: 16,
  },
  noticeSection: {
    paddingHorizontal: Layout.spacing.md,
  },
  section: {
    paddingHorizontal: Layout.spacing.md,
    marginBottom: 24,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  seeAll: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  periodBannerContainer: {
    paddingHorizontal: Layout.spacing.md,
    marginBottom: 12,
  },
  periodBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(253, 168, 58, 0.08)',
    borderWidth: 1,
    borderColor: 'rgba(253, 168, 58, 0.25)',
    borderRadius: Layout.radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 8,
  },
  periodBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  periodDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  periodBannerText: {
    color: Colors.text,
    fontSize: 12,
    flex: 1,
    fontWeight: '500',
  },
  periodBannerAction: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '700',
  },
});
