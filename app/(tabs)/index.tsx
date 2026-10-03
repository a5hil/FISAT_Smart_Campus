import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { Layout } from '../../constants/layout';
import { HomeHeader } from '../../components/HomeHeader';
import { EnergyOverviewCard } from '../../components/EnergyOverviewCard';
import { QuickControls } from '../../components/QuickControls';
import { ClassroomCard } from '../../components/ClassroomCard';
import { NoticeBoardCard } from '../../components/NoticeBoardCard';
import { useApp, useTheme } from '../../context/AppContext';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { triggerHaptic } from '../../utils/haptics';

export default function HomeScreen() {
  const { classrooms, timetable } = useApp();
  const { colors, isDark } = useTheme();
  const router = useRouter();

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  return (
    <View style={styles.container}>
      <HomeHeader />
      
      <ScrollView 
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <EnergyOverviewCard />

        {/* Classroom Timetable & Period Bell Automation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Classroom Timetable & Period Bell</Text>
          <TouchableOpacity 
            style={styles.timetableCard}
            activeOpacity={0.8}
            onPress={() => {
              triggerHaptic.light();
              router.push('/timetable');
            }}
          >
            <View style={styles.timetableIconBox}>
              <Ionicons name="notifications" size={24} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <View style={styles.timetableCardHeader}>
                <Text style={styles.timetableCardTitle}>Timetable Bell System</Text>
                <View style={[styles.badge, timetable.enabled ? styles.badgeActive : styles.badgeDisabled]}>
                  <Text style={[styles.badgeText, timetable.enabled ? styles.badgeTextActive : styles.badgeTextDisabled]}>
                    {timetable.enabled ? 'ACTIVE' : 'DISABLED'}
                  </Text>
                </View>
              </View>
              <Text style={styles.timetableCardSubtitle}>
                {timetable.periods.filter(p => p.enabled).length} periods • Tone: {timetable.defaultPattern.toUpperCase()}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={20} color={colors.textMuted} />
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
            <TouchableOpacity onPress={() => {
              triggerHaptic.light();
              router.push('/classrooms');
            }}>
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

function getStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
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
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
      marginBottom: 12,
    },
    seeAll: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    timetableCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 14,
    },
    timetableIconBox: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: colors.primarySubtle,
      justifyContent: 'center',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: colors.primarySubtle,
    },
    timetableCardHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    timetableCardTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
    },
    timetableCardSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 3,
    },
    badge: {
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 6,
      borderWidth: 1,
    },
    badgeActive: {
      backgroundColor: colors.successSubtle,
      borderColor: colors.successSubtle,
    },
    badgeDisabled: {
      backgroundColor: isDark ? 'rgba(150, 150, 150, 0.15)' : 'rgba(0, 0, 0, 0.06)',
      borderColor: isDark ? 'rgba(150, 150, 150, 0.3)' : 'rgba(0, 0, 0, 0.1)',
    },
    badgeText: {
      fontSize: 10,
      fontWeight: '700',
    },
    badgeTextActive: {
      color: colors.success,
    },
    badgeTextDisabled: {
      color: colors.textMuted,
    },
  });
}
