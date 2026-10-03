import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Modal, TextInput, Alert as RNAlert, Platform,
  KeyboardAvoidingView, TouchableWithoutFeedback, Keyboard,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { useApp, useTheme, migrateTimetableConfig } from '../context/AppContext';
import { TimetableConfig, TimetablePeriod, BellPattern } from '../types';
import { defaultTimetable } from '../mock_data/mockData';
import { DrumTimePickerModal } from '../components/DrumTimePickerModal';
import { triggerHaptic } from '../utils/haptics';

const DAYS = [
  { day: 1, label: 'Mon', full: 'Monday' },
  { day: 2, label: 'Tue', full: 'Tuesday' },
  { day: 3, label: 'Wed', full: 'Wednesday' },
  { day: 4, label: 'Thu', full: 'Thursday' },
  { day: 5, label: 'Fri', full: 'Friday' },
  { day: 6, label: 'Sat', full: 'Saturday' },
  { day: 0, label: 'Sun', full: 'Sunday' },
];

const BELL_PATTERNS: { id: BellPattern; name: string; desc: string; icon: string }[] = [
  { id: 'westminster', name: 'Westminster Chime', desc: 'Full 16-Note Big Ben Quarters', icon: 'musical-notes' },
  { id: 'st-michael', name: 'St. Michael Chime', desc: 'Historic 16-Note Cathedral Chime', icon: 'library' },
  { id: 'college-bell', name: 'College Bell', desc: '3 Ascending Academic Rings', icon: 'notifications' },
  { id: 'triple-chime', name: 'Triple Chime', desc: '3 Gentle Harmonic Notes', icon: 'volume-medium' },
  { id: 'lunch-fanfare', name: 'Lunch Fanfare', desc: '6-Note Upbeat Melody', icon: 'restaurant' },
  { id: 'dismissal-chime', name: 'Dismissal Scale', desc: '7-Note End-of-Day Chime', icon: 'walk' },
  { id: 'ding-dong', name: 'Classic Ding-Dong', desc: 'Warm 2-Tone Transition', icon: 'notifications-circle' },
  { id: 'marimba-cascade', name: 'Marimba Cascade', desc: '5-Note Flowing Chime', icon: 'water' },
  { id: 'digital-synth', name: 'Future Synth Chime', desc: '5-Note Rising Arpeggio', icon: 'sparkles' },
  { id: 'morning-reveille', name: 'Morning Fanfare', desc: '5-Note Motivating Assembly', icon: 'sunny' },
  { id: 'gentle-wind', name: 'Gentle Pentatonic', desc: '5-Note Relaxing Breeze', icon: 'leaf' },
  { id: 'double-beep', name: 'Double Beep', desc: '2 Crisp Alert Beeps', icon: 'flash' },
  { id: 'single-long', name: 'Single Long', desc: '1 Solid 1.5s Bell', icon: 'volume-high' },
];

export default function TimetableScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { timetable, updateTimetable, triggerBellTest, esp32Connected } = useApp();
  const { colors, isDark } = useTheme();

  const [activeConfig, setActiveConfig] = useState<TimetableConfig>(() => migrateTimetableConfig(timetable));
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);
  const [periodName, setPeriodName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [activeTimePicker, setActiveTimePicker] = useState<'start' | 'end' | null>(null);

  const formatTime12h = (timeStr: string): string => {
    const parts = (timeStr || '09:00').split(':');
    const h = parseInt(parts[0] || '0', 10);
    const m = parseInt(parts[1] || '0', 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  };

  const [periodType, setPeriodType] = useState<'class' | 'break' | 'lunch' | 'lab'>('class');
  const [testingBell, setTestingBell] = useState(false);

  // Day filter tab ('all' or day index 0..6)
  const [selectedDayTab, setSelectedDayTab] = useState<number | 'all'>('all');

  // Modal to select default fallback bell tone
  const [defaultToneModalVisible, setDefaultToneModalVisible] = useState(false);

  // Add/Edit modal: customized chime and day assignments
  const [periodBellPattern, setPeriodBellPattern] = useState<BellPattern>(activeConfig.defaultPattern || 'college-bell');
  const [periodDays, setPeriodDays] = useState<number[]>([]);

  const currentDefaultPattern = React.useMemo(() => {
    return BELL_PATTERNS.find(b => b.id === (activeConfig.defaultPattern || 'college-bell')) || BELL_PATTERNS.find(b => b.id === 'college-bell') || BELL_PATTERNS[0];
  }, [activeConfig.defaultPattern]);

  // Sync state if context updates, ensuring migration is applied immediately
  useEffect(() => {
    const migrated = migrateTimetableConfig(timetable);
    setActiveConfig(migrated);
    if (JSON.stringify(migrated) !== JSON.stringify(timetable)) {
      void updateTimetable(migrated);
    }
  }, [timetable, updateTimetable]);

  // Live period tracker
  const [currentTimeStr, setCurrentTimeStr] = useState('');
  const [currentPeriod, setCurrentPeriod] = useState<TimetablePeriod | null>(null);
  const [minutesRemaining, setMinutesRemaining] = useState<number | null>(null);
  const [nextPeriod, setNextPeriod] = useState<TimetablePeriod | null>(null);

  useEffect(() => {
    const updateTracker = () => {
      const now = new Date();
      const hours = now.getHours().toString().padStart(2, '0');
      const mins = now.getMinutes().toString().padStart(2, '0');
      const nowTime = `${hours}:${mins}`;
      const nowTotalMin = now.getHours() * 60 + now.getMinutes();
      setCurrentTimeStr(nowTime);

      const today = now.getDay();
      const isDayActive = activeConfig.activeDays.includes(today);

      if (!isDayActive || !activeConfig.enabled) {
        setCurrentPeriod(null);
        setMinutesRemaining(null);
        setNextPeriod(null);
        return;
      }

      // Find current period matching today's active schedule
      let foundCurrent: TimetablePeriod | null = null;
      let foundNext: TimetablePeriod | null = null;
      let minDiff: number | null = null;

      for (const p of activeConfig.periods) {
        if (!p.enabled) continue;
        if (p.days && p.days.length > 0 && !p.days.includes(today)) continue;

        const [sH, sM] = p.startTime.split(':').map(Number);
        const [eH, eM] = p.endTime.split(':').map(Number);
        const pStartMin = sH * 60 + sM;
        const pEndMin = eH * 60 + eM;

        if (nowTotalMin >= pStartMin && nowTotalMin < pEndMin) {
          foundCurrent = p;
          minDiff = pEndMin - nowTotalMin;
        } else if (nowTotalMin < pStartMin && !foundNext) {
          foundNext = p;
        }
      }

      setCurrentPeriod(foundCurrent);
      setMinutesRemaining(minDiff);
      setNextPeriod(foundNext);
    };

    updateTracker();
    const interval = setInterval(updateTracker, 10000);
    return () => clearInterval(interval);
  }, [activeConfig]);

  const handleToggleMaster = (val: boolean) => {
    triggerHaptic.medium();
    const updated = { ...activeConfig, enabled: val };
    setActiveConfig(updated);
    void updateTimetable(updated);
  };

  const handleToggleDay = (day: number) => {
    triggerHaptic.selection();
    let days = [...activeConfig.activeDays];
    if (days.includes(day)) {
      if (days.length === 1) {
        RNAlert.alert('Selection', 'At least one active day is required.');
        return;
      }
      days = days.filter(d => d !== day);
    } else {
      days.push(day);
      days.sort((a, b) => a - b);
    }
    const updated = { ...activeConfig, activeDays: days };
    setActiveConfig(updated);
    void updateTimetable(updated);
  };

  const handleSelectPattern = (pattern: BellPattern) => {
    triggerHaptic.selection();
    const updated = { ...activeConfig, defaultPattern: pattern };
    setActiveConfig(updated);
    void updateTimetable(updated);
  };

  const handleTogglePeriod = (id: string) => {
    triggerHaptic.medium();
    const updatedPeriods = activeConfig.periods.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p);
    const updated = { ...activeConfig, periods: updatedPeriods };
    setActiveConfig(updated);
    void updateTimetable(updated);
  };

  const handleTestBell = async () => {
    triggerHaptic.medium();
    setTestingBell(true);
    await triggerBellTest(activeConfig.defaultPattern);
    setTestingBell(false);
  };

  const formatPeriodDays = (days?: number[]) => {
    if (!days || days.length === 0) return 'All Active Days';
    if (days.length === 1) {
      const d = DAYS.find(x => x.day === days[0]);
      return `${d ? d.label : days[0]} Only`;
    }
    const sorted = [...days].sort((a, b) => a - b);
    if (sorted.length === 4 && sorted.join(',') === '1,2,3,4') return 'Mon – Thu';
    if (sorted.length === 5 && sorted.join(',') === '1,2,3,4,5') return 'Mon – Fri';
    return sorted.map(d => DAYS.find(x => x.day === d)?.label || d).join(', ');
  };

  const getPeriodChime = (pat?: BellPattern) => {
    const id = pat || activeConfig.defaultPattern || 'college-bell';
    return BELL_PATTERNS.find(b => b.id === id) || BELL_PATTERNS.find(b => b.id === 'college-bell') || BELL_PATTERNS[0];
  };

  const displayedPeriods = React.useMemo(() => {
    if (selectedDayTab === 'all') return activeConfig.periods;
    return activeConfig.periods.filter(p => !p.days || p.days.length === 0 || p.days.includes(selectedDayTab));
  }, [activeConfig.periods, selectedDayTab]);

  const openAddModal = () => {
    triggerHaptic.light();
    setEditingPeriodId(null);
    const dayFilteredPeriods = selectedDayTab === 'all'
      ? activeConfig.periods
      : activeConfig.periods.filter(p => !p.days || p.days.length === 0 || p.days.includes(selectedDayTab));

    setPeriodName(`Period ${dayFilteredPeriods.filter(p => p.type === 'class').length + 1}`);
    setStartTime('09:00');
    setEndTime('10:00');
    setPeriodType('class');
    setPeriodBellPattern(activeConfig.defaultPattern || 'college-bell');
    setPeriodDays(selectedDayTab !== 'all' ? [selectedDayTab] : []);
    setModalVisible(true);
  };

  const openEditModal = (p: TimetablePeriod) => {
    triggerHaptic.light();
    setEditingPeriodId(p.id);
    setPeriodName(p.name);
    setStartTime(p.startTime);
    setEndTime(p.endTime);
    setPeriodType(p.type);
    setPeriodBellPattern(p.bellPattern || activeConfig.defaultPattern);
    setPeriodDays(p.days && p.days.length > 0 ? [...p.days] : []);
    setModalVisible(true);
  };

  const handleResetToDefaults = () => {
    triggerHaptic.warning();
    RNAlert.alert(
      'Reset Schedule to Defaults',
      'This will reset your class timetable to the recommended standard chime config:\n\n• Hour 1: Westminster Chime\n• Period 2–5: College Bell\n• Morning Tea Break: Triple Chime\n• Lunch Break: St. Michael Chime\n• Hour 6 Dismissal: Dismissal Scale\n• Master Default: College Bell\n\nDo you want to proceed?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset Schedule',
          style: 'destructive',
          onPress: async () => {
            triggerHaptic.success();
            setActiveConfig(defaultTimetable);
            await updateTimetable(defaultTimetable);
          },
        },
      ]
    );
  };

  const handleSavePeriod = () => {
    if (!periodName.trim()) {
      triggerHaptic.warning();
      RNAlert.alert('Required', 'Please enter a period title.');
      return;
    }
    if (!startTime.includes(':') || !endTime.includes(':')) {
      triggerHaptic.warning();
      RNAlert.alert('Invalid Format', 'Please enter time in HH:mm format (e.g. 09:00).');
      return;
    }

    const normalizeTime = (t: string) => {
      const parts = t.trim().split(':');
      if (parts.length === 2) {
        const hh = parts[0].padStart(2, '0');
        const mm = parts[1].padStart(2, '0');
        return `${hh}:${mm}`;
      }
      return t.trim();
    };

    const cleanStart = normalizeTime(startTime);
    const cleanEnd = normalizeTime(endTime);

    if (cleanStart >= cleanEnd) {
      triggerHaptic.warning();
      RNAlert.alert('Invalid Time', 'End time must be later than start time.');
      return;
    }

    triggerHaptic.success();
    const assignedDays = periodDays.length > 0 ? [...periodDays].sort((a, b) => a - b) : undefined;

    let updatedPeriods = [...activeConfig.periods];
    if (editingPeriodId) {
      updatedPeriods = updatedPeriods.map(p => p.id === editingPeriodId ? {
        ...p,
        name: periodName.trim(),
        startTime: cleanStart,
        endTime: cleanEnd,
        type: periodType,
        bellPattern: periodBellPattern,
        days: assignedDays,
      } : p);
    } else {
      const newP: TimetablePeriod = {
        id: `p-${Date.now()}`,
        name: periodName.trim(),
        startTime: cleanStart,
        endTime: cleanEnd,
        type: periodType,
        enabled: true,
        bellPattern: periodBellPattern,
        days: assignedDays,
      };
      updatedPeriods.push(newP);
    }

    // Sort periods chronologically
    updatedPeriods.sort((a, b) => a.startTime.localeCompare(b.startTime));

    const updated = { ...activeConfig, periods: updatedPeriods };
    setActiveConfig(updated);
    void updateTimetable(updated);
    setModalVisible(false);
  };

  const handleDuplicateToDay = (targetDay: number) => {
    triggerHaptic.medium();
    const targetLabel = DAYS.find(d => d.day === targetDay)?.full || DAYS.find(d => d.day === targetDay)?.label || `Day ${targetDay}`;
    const basePeriods = activeConfig.periods.filter(p => !p.days || p.days.length === 0 || p.days.includes(1));
    if (basePeriods.length === 0) {
      RNAlert.alert('Notice', 'No standard schedule periods available to copy.');
      return;
    }

    RNAlert.alert(
      `Copy to ${targetLabel}`,
      `Would you like to copy ${basePeriods.length} periods from your standard schedule to ${targetLabel}? You can then adjust timings specifically for this day.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Copy Schedule',
          onPress: () => {
            triggerHaptic.success();
            const duplicated: TimetablePeriod[] = basePeriods.map((p, idx) => ({
              ...p,
              id: `p-${Date.now()}-${idx}`,
              name: p.name,
              startTime: p.startTime,
              endTime: p.endTime,
              type: p.type,
              enabled: true,
              bellPattern: p.bellPattern || activeConfig.defaultPattern,
              days: [targetDay],
            }));
            const updatedPeriods = [...activeConfig.periods, ...duplicated];
            updatedPeriods.sort((a, b) => a.startTime.localeCompare(b.startTime));
            const updated = { ...activeConfig, periods: updatedPeriods };
            setActiveConfig(updated);
            void updateTimetable(updated);
          }
        }
      ]
    );
  };

  const handleDeletePeriod = (id: string) => {
    triggerHaptic.medium();
    RNAlert.alert(
      'Delete Period',
      'Are you sure you want to remove this period from the schedule?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            triggerHaptic.heavy();
            const updatedPeriods = activeConfig.periods.filter(p => p.id !== id);
            const updated = { ...activeConfig, periods: updatedPeriods };
            setActiveConfig(updated);
            void updateTimetable(updated);
          },
        },
      ]
    );
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'break': return colors.warning;
      case 'lunch': return colors.success;
      case 'lab': return '#9B51E0';
      default: return colors.primary;
    }
  };

  return (
    <View style={styles.container}>
      {/* Screen Header */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, 16) }]}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => {
            triggerHaptic.light();
            router.back();
          }}
        >
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle}>Class Timetable & Bell</Text>
          <Text style={styles.headerSubtitle}>FISAT Automated Period Schedule</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Live Period Status Card */}
        <View style={styles.liveCard}>
          <View style={styles.liveHeaderRow}>
            <View style={styles.liveBadgeRow}>
              <View style={[styles.liveDot, { backgroundColor: currentPeriod ? colors.success : colors.textMuted }]} />
              <Text style={styles.liveBadgeText}>
                {currentPeriod ? 'CLASS IN SESSION' : 'NO CLASS ACTIVE'}
              </Text>
            </View>
            <Text style={styles.liveTime}>{currentTimeStr}</Text>
          </View>

          {currentPeriod ? (
            <View style={styles.currentPeriodInfo}>
              <Text style={styles.currentPeriodName}>{currentPeriod.name}</Text>
              <Text style={styles.currentPeriodTime}>
                {currentPeriod.startTime} — {currentPeriod.endTime}
              </Text>
              <View style={[styles.countdownBadge, !activeConfig.enabled && styles.countdownBadgePaused]}>
                <Ionicons
                  name={activeConfig.enabled ? "alarm-outline" : "notifications-off-outline"}
                  size={16}
                  color={activeConfig.enabled ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.countdownText, !activeConfig.enabled && styles.countdownTextPaused]}>
                  Hour ends in {minutesRemaining} min{minutesRemaining === 1 ? '' : 's'}
                  {activeConfig.enabled ? ' (Buzzer will ring)' : ' (Bell paused)'}
                </Text>
              </View>
            </View>
          ) : (
            <View style={styles.idlePeriodInfo}>
              <Text style={styles.idleTitle}>Outside Scheduled Hours</Text>
              {nextPeriod ? (
                <Text style={styles.idleSub}>Next: {nextPeriod.name} at {nextPeriod.startTime}</Text>
              ) : (
                <Text style={styles.idleSub}>All scheduled periods complete for today</Text>
              )}
            </View>
          )}
        </View>

        {/* Master Enable & Bell Pattern Card */}
        <View style={styles.sectionCard}>
          <View style={styles.cardHeaderRow}>
            <View style={styles.cardIconBox}>
              <Ionicons name="notifications" size={20} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Automated Period Bell</Text>
              <Text style={styles.sectionSubtitle}>Bell rings when each hour is over</Text>
            </View>
            <Switch
              value={activeConfig.enabled}
              onValueChange={handleToggleMaster}
              trackColor={{ false: isDark ? 'rgba(255, 255, 255, 0.15)' : 'rgba(0, 0, 0, 0.12)', true: colors.primary }}
              thumbColor={activeConfig.enabled ? '#FFF' : (isDark ? '#DDD' : '#F1F5F9')}
            />
          </View>

          {/* Active Days Pills */}
          <Text style={styles.subLabel}>Active Days</Text>
          <View style={styles.daysRow}>
            {DAYS.map(d => {
              const active = activeConfig.activeDays.includes(d.day);
              return (
                <TouchableOpacity
                  key={d.day}
                  style={[styles.dayPill, active && styles.dayPillActive]}
                  onPress={() => handleToggleDay(d.day)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.dayPillText, active && styles.dayPillTextActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Default Period Bell & Hardware Test Card */}
          <View style={styles.defaultToneCard}>
            <View style={styles.defaultToneHeader}>
              <TouchableOpacity
                style={styles.defaultToneLeft}
                onPress={() => {
                  triggerHaptic.light();
                  setDefaultToneModalVisible(true);
                }}
                activeOpacity={0.75}
              >
                <View style={styles.defaultToneIconBox}>
                  <Ionicons name={currentDefaultPattern.icon as any} size={18} color={colors.primary} />
                </View>
                <View style={styles.defaultToneInfo}>
                  <Text style={styles.defaultToneTitle}>Default Period Chime</Text>
                  <Text style={styles.defaultToneSub} numberOfLines={1}>
                    {currentDefaultPattern.name} • Fallback tone
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={styles.defaultToneRightActions}>
                <TouchableOpacity
                  style={styles.defaultToneChangePill}
                  onPress={() => {
                    triggerHaptic.light();
                    setDefaultToneModalVisible(true);
                  }}
                  activeOpacity={0.7}
                >
                  <Text style={styles.defaultToneChangeText}>Change</Text>
                  <Ionicons name="chevron-forward" size={12} color={colors.primary} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.testBuzzerBtnCompact, testingBell && styles.testBuzzerBtnActive]}
                  onPress={handleTestBell}
                  disabled={testingBell}
                  activeOpacity={0.7}
                >
                  <Ionicons
                    name={testingBell ? "radio-outline" : "volume-medium-outline"}
                    size={14}
                    color={isDark ? '#000000' : '#FFFFFF'}
                  />
                  <Text style={styles.testBuzzerBtnText}>
                    {testingBell ? 'Ringing...' : 'Test Bell'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </View>

        {/* Schedule List Header & Day Filter */}
        <View style={styles.scheduleHeaderRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.scheduleSectionTitle}>Class Schedule</Text>
            <Text style={styles.scheduleSubtitle}>
              {selectedDayTab === 'all'
                ? `Showing all ${activeConfig.periods.length} scheduled periods`
                : `${DAYS.find(d => d.day === selectedDayTab)?.label} timetable (${displayedPeriods.length} periods)`}
            </Text>
          </View>
          <View style={styles.scheduleHeaderActions}>
            <TouchableOpacity
              style={styles.resetScheduleBtn}
              onPress={handleResetToDefaults}
              activeOpacity={0.7}
            >
              <Ionicons name="refresh-outline" size={13} color={colors.textMuted} />
              <Text style={styles.resetScheduleBtnText}>Reset</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.addTextBtn} onPress={openAddModal}>
              <Ionicons name="add-circle-outline" size={16} color={colors.primary} />
              <Text style={styles.addTextBtnLabel}>Add Period</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Day Filter Tabs */}
        <View style={styles.dayFilterContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.dayFilterScroll}>
            <TouchableOpacity
              style={[styles.dayFilterTab, selectedDayTab === 'all' && styles.dayFilterTabActive]}
              onPress={() => {
                triggerHaptic.selection();
                setSelectedDayTab('all');
              }}
            >
              <Text style={[styles.dayFilterTabText, selectedDayTab === 'all' && styles.dayFilterTabTextActive]}>
                All Days
              </Text>
              <View style={[styles.dayCountBadge, selectedDayTab === 'all' && styles.dayCountBadgeActive]}>
                <Text style={[styles.dayCountText, selectedDayTab === 'all' && styles.dayCountTextActive]}>
                  {activeConfig.periods.length}
                </Text>
              </View>
            </TouchableOpacity>

            {DAYS.map(d => {
              const count = activeConfig.periods.filter(p => !p.days || p.days.length === 0 || p.days.includes(d.day)).length;
              const isSelected = selectedDayTab === d.day;
              const isToday = new Date().getDay() === d.day;

              return (
                <TouchableOpacity
                  key={d.day}
                  style={[styles.dayFilterTab, isSelected && styles.dayFilterTabActive]}
                  onPress={() => {
                    triggerHaptic.selection();
                    setSelectedDayTab(d.day);
                  }}
                >
                  {isToday && <View style={[styles.todayDot, isSelected && { backgroundColor: '#FFF' }]} />}
                  <Text style={[styles.dayFilterTabText, isSelected && styles.dayFilterTabTextActive]}>
                    {d.label}
                  </Text>
                  <View style={[styles.dayCountBadge, isSelected && styles.dayCountBadgeActive]}>
                    <Text style={[styles.dayCountText, isSelected && styles.dayCountTextActive]}>
                      {count}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>

        {/* Day-specific banner with Copy action */}
        {selectedDayTab !== 'all' && (
          <View style={styles.dayBanner}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dayBannerTitle}>
                {DAYS.find(d => d.day === selectedDayTab)?.full || DAYS.find(d => d.day === selectedDayTab)?.label} Custom Timetable
              </Text>
              <Text style={styles.dayBannerSub}>
                Periods here apply only on this day
              </Text>
            </View>
            <TouchableOpacity
              style={styles.duplicateBtn}
              onPress={() => handleDuplicateToDay(selectedDayTab as number)}
              activeOpacity={0.75}
            >
              <Ionicons name="copy-outline" size={13} color={colors.primary} />
              <Text style={styles.duplicateBtnText}>Copy Standard Schedule</Text>
            </TouchableOpacity>
          </View>
        )}

        {displayedPeriods.length === 0 ? (
          <View style={styles.emptyDayBox}>
            <Ionicons name="calendar-outline" size={32} color={colors.textMuted} />
            <Text style={styles.emptyDayTitle}>
              No Custom Periods for {selectedDayTab === 'all' ? 'Schedule' : (DAYS.find(d => d.day === selectedDayTab)?.full || DAYS.find(d => d.day === selectedDayTab)?.label)}
            </Text>
            <Text style={styles.emptyDaySub}>Add periods or copy from the standard schedule</Text>
            <TouchableOpacity style={styles.emptyAddBtn} onPress={openAddModal}>
              <Ionicons name="add" size={16} color={isDark ? '#000' : '#FFF'} />
              <Text style={styles.emptyAddBtnText}>Add Period for this Day</Text>
            </TouchableOpacity>
          </View>
        ) : (
          displayedPeriods.map((p, idx) => {
            const typeColor = getTypeColor(p.type);
            const pChime = getPeriodChime(p.bellPattern);
            const dayLabel = formatPeriodDays(p.days);

            return (
              <View key={p.id} style={[styles.periodCard, !p.enabled && styles.periodCardDisabled]}>
                <View style={[styles.periodTypeBar, { backgroundColor: typeColor }]} />

                <View style={styles.periodContent}>
                  <View style={styles.periodTopRow}>
                    <TouchableOpacity
                      style={styles.periodTitleRow}
                      onPress={() => openEditModal(p)}
                      activeOpacity={0.7}
                    >
                      <Text style={[styles.periodNameText, !p.enabled && styles.textDisabled]}>
                        {p.name}
                      </Text>
                      <View style={[styles.typeBadge, { borderColor: typeColor }]}>
                        <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                          {p.type.toUpperCase()}
                        </Text>
                      </View>
                    </TouchableOpacity>

                    <Switch
                      value={p.enabled}
                      onValueChange={() => handleTogglePeriod(p.id)}
                      trackColor={{ false: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.12)', true: colors.primary }}
                      thumbColor={p.enabled ? '#FFF' : '#AAA'}
                      style={{ transform: [{ scale: 0.85 }] }}
                    />
                  </View>

                  <TouchableOpacity
                    style={styles.periodMetaRow}
                    onPress={() => openEditModal(p)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.timeTag}>
                      <Ionicons name="time-outline" size={13} color={colors.textMuted} />
                      <Text style={styles.timeTagText}>
                        {p.startTime} — {p.endTime}
                      </Text>
                    </View>

                    <View style={[styles.dayTag, p.days && p.days.length > 0 && styles.dayTagCustom]}>
                      <Ionicons
                        name="calendar-outline"
                        size={11}
                        color={p.days && p.days.length > 0 ? (isDark ? '#FCA5A5' : '#DC2626') : colors.textMuted}
                      />
                      <Text
                        style={[styles.dayTagText, p.days && p.days.length > 0 && styles.dayTagTextCustom]}
                        numberOfLines={1}
                      >
                        {dayLabel}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <View style={styles.periodBottomRow}>
                    <TouchableOpacity
                      style={styles.chimeBadge}
                      onPress={async () => {
                        triggerHaptic.light();
                        setTestingBell(true);
                        await triggerBellTest(pChime.id);
                        setTestingBell(false);
                      }}
                      hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
                      activeOpacity={0.7}
                    >
                      <Ionicons name={pChime.icon as any} size={13} color={colors.primary} />
                      <Text style={styles.chimeBadgeText} numberOfLines={1}>
                        {pChime.name}
                      </Text>
                      <Ionicons name="play-circle" size={14} color={colors.primary} />
                    </TouchableOpacity>

                    <View style={styles.periodActions}>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => openEditModal(p)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="create-outline" size={16} color={colors.textMuted} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={styles.actionBtn}
                        onPress={() => handleDeletePeriod(p.id)}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons name="trash-outline" size={16} color={colors.critical} />
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>
              </View>
            );
          })
        )}

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Add / Edit Period Modal */}
      <Modal visible={modalVisible} transparent animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.modalDismissArea}>
              <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
                <View style={styles.modalContent}>
                  <View style={styles.modalHeader}>
                    <View>
                      <Text style={styles.modalTitle}>
                        {editingPeriodId ? 'Edit Schedule Period' : 'Add Schedule Period'}
                      </Text>
                      <Text style={styles.modalSubtitle}>
                        Set timings, customized chime & days
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        triggerHaptic.light();
                        setModalVisible(false);
                      }}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="close" size={22} color={colors.text} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView style={styles.modalScroll} showsVerticalScrollIndicator={false}>
                    <Text style={styles.inputLabel}>Period Title</Text>
                    <TextInput
                      style={styles.textInput}
                      placeholder="e.g. Period 1, Friday Assembly, Tea Break"
                      placeholderTextColor={colors.inputPlaceholder}
                      value={periodName}
                      onChangeText={setPeriodName}
                    />

                    <Text style={styles.inputLabel}>Period Timing</Text>
                    <View style={styles.timePickerBoxesRow}>
                      <TouchableOpacity
                        style={styles.timeSetterBox}
                        onPress={() => {
                          triggerHaptic.light();
                          setActiveTimePicker('start');
                        }}
                        activeOpacity={0.75}
                      >
                        <View style={styles.timeSetterBoxHeader}>
                          <Ionicons name="play-circle-outline" size={14} color={colors.primary} />
                          <Text style={styles.timeSetterBoxTitle}>START TIME</Text>
                        </View>
                        <Text style={styles.timeDisplayBig}>{formatTime12h(startTime)}</Text>
                        <Text style={styles.timeDisplaySub}>{startTime} (24-Hour)</Text>
                      </TouchableOpacity>

                      <View style={styles.timeArrowDivider}>
                        <Ionicons name="arrow-forward" size={16} color={colors.textMuted} />
                      </View>

                      <TouchableOpacity
                        style={styles.timeSetterBox}
                        onPress={() => {
                          triggerHaptic.light();
                          setActiveTimePicker('end');
                        }}
                        activeOpacity={0.75}
                      >
                        <View style={styles.timeSetterBoxHeader}>
                          <Ionicons name="stop-circle-outline" size={14} color={colors.critical} />
                          <Text style={styles.timeSetterBoxTitle}>END TIME</Text>
                        </View>
                        <Text style={styles.timeDisplayBig}>{formatTime12h(endTime)}</Text>
                        <Text style={styles.timeDisplaySub}>{endTime} (24-Hour)</Text>
                      </TouchableOpacity>
                    </View>

                    <Text style={styles.inputLabel}>Period Type</Text>
                    <View style={styles.typeSelectorRow}>
                      {(['class', 'break', 'lunch', 'lab'] as const).map(t => (
                        <TouchableOpacity
                          key={t}
                          style={[styles.typePill, periodType === t && styles.typePillActive]}
                          onPress={() => {
                            triggerHaptic.selection();
                            setPeriodType(t);
                          }}
                        >
                          <Text style={[styles.typePillText, periodType === t && styles.typePillTextActive]}>
                            {t.toUpperCase()}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>

                    {/* Customized Period Bell Chime Selector */}
                    <View style={styles.modalSectionHeader}>
                      <Text style={styles.inputLabel}>Period Bell Chime</Text>
                      <Text style={styles.inputSubLabel}>Select unique tune to sound when this period ends</Text>
                    </View>
                    <View style={styles.modalChimeGrid}>
                      {BELL_PATTERNS.map(pat => {
                        const isSelected = periodBellPattern === pat.id;
                        return (
                          <TouchableOpacity
                            key={pat.id}
                            style={[styles.modalChimeCard, isSelected && styles.modalChimeCardActive]}
                            onPress={() => {
                              triggerHaptic.selection();
                              setPeriodBellPattern(pat.id);
                            }}
                            activeOpacity={0.7}
                          >
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                              <Ionicons
                                name={pat.icon as any}
                                size={15}
                                color={isSelected ? colors.primary : colors.textMuted}
                              />
                              <TouchableOpacity
                                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                                onPress={async (e) => {
                                  e.stopPropagation();
                                  triggerHaptic.light();
                                  await triggerBellTest(pat.id);
                                }}
                                style={styles.chimePlayMini}
                              >
                                <Ionicons
                                  name="play-circle"
                                  size={16}
                                  color={isSelected ? colors.primary : colors.textMuted}
                                />
                              </TouchableOpacity>
                            </View>
                            <Text
                              style={[styles.modalChimeName, isSelected && styles.modalChimeNameActive]}
                              numberOfLines={1}
                            >
                              {pat.name}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    {/* Applies to Days (e.g. Friday customization) */}
                    <View style={[styles.modalSectionHeader, { marginTop: 14 }]}>
                      <Text style={styles.inputLabel}>Applies to Days</Text>
                      <Text style={styles.inputSubLabel}>Customize timing for Friday or specific days</Text>
                    </View>

                    {/* Quick Presets */}
                    <View style={styles.quickPresetRow}>
                      <TouchableOpacity
                        style={[styles.presetChip, periodDays.length === 0 && styles.presetChipActive]}
                        onPress={() => {
                          triggerHaptic.selection();
                          setPeriodDays([]);
                        }}
                      >
                        <Text style={[styles.presetChipText, periodDays.length === 0 && styles.presetChipTextActive]}>
                          All Active Days
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.presetChip,
                          periodDays.length === 4 && periodDays.join(',') === '1,2,3,4' && styles.presetChipActive,
                        ]}
                        onPress={() => {
                          triggerHaptic.selection();
                          setPeriodDays([1, 2, 3, 4]);
                        }}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            periodDays.length === 4 && periodDays.join(',') === '1,2,3,4' && styles.presetChipTextActive,
                          ]}
                        >
                          Mon – Thu
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.presetChip,
                          periodDays.length === 1 && periodDays[0] === 5 && styles.presetChipActive,
                        ]}
                        onPress={() => {
                          triggerHaptic.selection();
                          setPeriodDays([5]);
                        }}
                      >
                        <Text
                          style={[
                            styles.presetChipText,
                            periodDays.length === 1 && periodDays[0] === 5 && styles.presetChipTextActive,
                          ]}
                        >
                          Friday Only
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* Day Pills */}
                    <View style={styles.modalDaysRow}>
                      {DAYS.map(d => {
                        const isIncluded = periodDays.length === 0
                          ? activeConfig.activeDays.includes(d.day)
                          : periodDays.includes(d.day);
                        const isCustom = periodDays.length > 0 && periodDays.includes(d.day);

                        return (
                          <TouchableOpacity
                            key={d.day}
                            style={[
                              styles.modalDayPill,
                              isIncluded && styles.modalDayPillActive,
                              isCustom && styles.modalDayPillCustom,
                            ]}
                            onPress={() => {
                              triggerHaptic.selection();
                              let next = periodDays.length === 0 ? [...activeConfig.activeDays] : [...periodDays];
                              if (next.includes(d.day)) {
                                next = next.filter(x => x !== d.day);
                              } else {
                                next.push(d.day);
                                next.sort((a, b) => a - b);
                              }
                              setPeriodDays(next);
                            }}
                          >
                            <Text
                              style={[
                                styles.modalDayPillText,
                                isIncluded && styles.modalDayPillTextActive,
                              ]}
                            >
                              {d.label}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>

                    <View style={{ height: 16 }} />
                  </ScrollView>

                  <View style={styles.modalBtnRow}>
                    <TouchableOpacity
                      style={styles.modalCancelBtn}
                      onPress={() => {
                        triggerHaptic.light();
                        setModalVisible(false);
                      }}
                    >
                      <Text style={styles.modalCancelBtnText}>Cancel</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.modalSaveBtn}
                      onPress={handleSavePeriod}
                    >
                      <Text style={styles.modalSaveBtnText}>Save Period</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal: Select Default Fallback Bell Tone */}
      <Modal
        visible={defaultToneModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDefaultToneModalVisible(false)}
      >
        <TouchableWithoutFeedback onPress={() => setDefaultToneModalVisible(false)}>
          <View style={styles.modalOverlay}>
            <TouchableWithoutFeedback onPress={e => e.stopPropagation()}>
              <View style={styles.modalContent}>
                <View style={styles.modalHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.modalTitle}>Default Period Chime</Text>
                    <Text style={styles.modalSubtitle}>
                      Fallback tone used when a period doesn't specify a custom chime
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => {
                      triggerHaptic.light();
                      setDefaultToneModalVisible(false);
                    }}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Ionicons name="close" size={22} color={colors.textMuted} />
                  </TouchableOpacity>
                </View>

                <ScrollView style={{ maxHeight: 380, marginVertical: 8 }} showsVerticalScrollIndicator={false}>
                  <View style={styles.modalChimeGrid}>
                    {BELL_PATTERNS.map(pat => {
                      const isSelected = activeConfig.defaultPattern === pat.id;
                      return (
                        <TouchableOpacity
                          key={pat.id}
                          style={[styles.modalChimeCard, isSelected && styles.modalChimeCardActive]}
                          onPress={() => {
                            triggerHaptic.selection();
                            handleSelectPattern(pat.id);
                            setDefaultToneModalVisible(false);
                          }}
                          activeOpacity={0.7}
                        >
                          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                            <Ionicons
                              name={pat.icon as any}
                              size={15}
                              color={isSelected ? colors.primary : colors.textMuted}
                            />
                            <TouchableOpacity
                              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                              onPress={async (e) => {
                                e.stopPropagation();
                                triggerHaptic.light();
                                await triggerBellTest(pat.id);
                              }}
                              style={styles.chimePlayMini}
                            >
                              <Ionicons
                                name="play-circle"
                                size={16}
                                color={isSelected ? colors.primary : colors.textMuted}
                              />
                            </TouchableOpacity>
                          </View>
                          <Text
                            style={[styles.modalChimeName, isSelected && styles.modalChimeNameActive]}
                            numberOfLines={1}
                          >
                            {pat.name}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </ScrollView>

                <TouchableOpacity
                  style={styles.modalDoneBtn}
                  onPress={() => {
                    triggerHaptic.light();
                    setDefaultToneModalVisible(false);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.modalDoneBtnText}>Done</Text>
                </TouchableOpacity>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Smooth Drum Wheel Roller Time Picker Modal for Period Timings */}
      <DrumTimePickerModal
        visible={activeTimePicker !== null}
        target={activeTimePicker === 'start' ? 'on' : 'off'}
        initialTime={activeTimePicker === 'start' ? startTime : endTime}
        title={activeTimePicker === 'start' ? 'Set Period Start Time' : 'Set Period End Time'}
        subtitle={activeTimePicker === 'start' ? `Schedule start time for ${periodName || 'period'}` : `Schedule end time for ${periodName || 'period'}`}
        onConfirm={(formattedTime) => {
          if (activeTimePicker === 'start') {
            setStartTime(formattedTime);
          } else if (activeTimePicker === 'end') {
            setEndTime(formattedTime);
          }
          setActiveTimePicker(null);
        }}
        onCancel={() => setActiveTimePicker(null)}
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
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: Layout.spacing.md,
      paddingTop: 16,
      paddingBottom: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    backButton: {
      padding: 8,
      marginRight: 6,
    },
    headerTextContainer: {
      flex: 1,
    },
    headerTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    headerSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
    },
    scrollContent: {
      padding: Layout.spacing.md,
    },
    liveCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.3)' : 'rgba(217, 119, 6, 0.25)',
      marginBottom: 16,
    },
    liveHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 12,
    },
    liveBadgeRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    liveDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    liveBadgeText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    liveTime: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
      fontVariant: ['tabular-nums'],
    },
    currentPeriodInfo: {
      gap: 4,
    },
    currentPeriodName: {
      color: colors.text,
      fontSize: 20,
      fontWeight: '700',
    },
    currentPeriodTime: {
      color: colors.primary,
      fontSize: 14,
      fontWeight: '600',
    },
    countdownBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.1)' : 'rgba(217, 119, 6, 0.08)',
      borderRadius: Layout.radius.sm,
      paddingHorizontal: 10,
      paddingVertical: 6,
      marginTop: 8,
      alignSelf: 'flex-start',
    },
    countdownText: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '600',
    },
    countdownBadgePaused: {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
    },
    countdownTextPaused: {
      color: colors.textMuted,
    },
    idlePeriodInfo: {
      gap: 4,
    },
    idleTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '600',
    },
    idleSub: {
      color: colors.textMuted,
      fontSize: 13,
    },
    sectionCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 20,
    },
    cardHeaderRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      marginBottom: 16,
    },
    cardIconBox: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.12)' : 'rgba(217, 119, 6, 0.1)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    sectionSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
    },
    subLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 8,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    daysRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 18,
    },
    dayPill: {
      width: 40,
      height: 36,
      borderRadius: Layout.radius.md,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    dayPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayPillText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    dayPillTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontWeight: '700',
    },
    defaultToneCard: {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : colors.cardSecondary,
      borderRadius: Layout.radius.md,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: 12,
      gap: 10,
    },
    defaultToneHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 10,
    },
    defaultToneLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      flex: 1,
    },
    defaultToneIconBox: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    defaultToneInfo: {
      flex: 1,
    },
    defaultToneTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    defaultToneSub: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    defaultToneRightActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flexShrink: 0,
    },
    defaultToneChangePill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.12)' : 'rgba(217, 119, 6, 0.1)',
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: Layout.radius.sm,
    },
    defaultToneChangeText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    testBuzzerBtnCompact: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Layout.radius.sm,
      backgroundColor: colors.primary,
    },
    testBuzzerBtnActive: {
      opacity: 0.75,
    },
    testBuzzerBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
    },
    scheduleHeaderRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 10,
    },
    scheduleSectionTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    scheduleSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    scheduleHeaderActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    resetScheduleBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 9,
      paddingVertical: 6,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: isDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.1)',
    },
    resetScheduleBtnText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    addTextBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.12)' : 'rgba(217, 119, 6, 0.1)',
    },
    addTextBtnLabel: {
      color: colors.primary,
      fontSize: 12,
      fontWeight: '700',
    },
    dayFilterContainer: {
      marginBottom: 12,
    },
    dayFilterScroll: {
      gap: 6,
      paddingVertical: 2,
    },
    dayFilterTab: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 20,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 6,
    },
    dayFilterTabActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    dayFilterTabInactive: {
      opacity: 0.6,
    },
    dayFilterTabText: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
    },
    dayFilterTabTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontWeight: '700',
    },
    dayCountBadge: {
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.08)',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: 10,
    },
    dayCountBadgeActive: {
      backgroundColor: isDark ? 'rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.25)',
    },
    dayCountText: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '700',
    },
    dayCountTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
    },
    todayDot: {
      width: 5,
      height: 5,
      borderRadius: 2.5,
      backgroundColor: colors.primary,
    },
    dayBanner: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.08)' : 'rgba(217, 119, 6, 0.06)',
      borderWidth: 1,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.2)' : 'rgba(217, 119, 6, 0.15)',
      borderRadius: Layout.radius.md,
      paddingHorizontal: 12,
      paddingVertical: 10,
      marginBottom: 12,
      gap: 8,
    },
    dayBannerTitle: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '700',
    },
    dayBannerSub: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 2,
    },
    duplicateBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
    },
    duplicateBtnText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },
    emptyDayBox: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 32,
      paddingHorizontal: 20,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.02)' : colors.cardSecondary,
      borderRadius: Layout.radius.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderStyle: 'dashed',
      marginBottom: 16,
      gap: 6,
    },
    emptyDayTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 4,
    },
    emptyDaySub: {
      color: colors.textMuted,
      fontSize: 12,
      textAlign: 'center',
    },
    emptyAddBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: colors.primary,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: Layout.radius.md,
      marginTop: 10,
    },
    emptyAddBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 12,
      fontWeight: '700',
    },
    periodCard: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: Layout.radius.md,
      marginBottom: 10,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      overflow: 'hidden',
    },
    periodCardDisabled: {
      opacity: 0.5,
    },
    periodTypeBar: {
      width: 5,
    },
    periodContent: {
      flex: 1,
      padding: 12,
      gap: 6,
    },
    periodTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    periodTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      flex: 1,
    },
    periodNameText: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '600',
      flexShrink: 1,
    },
    typeBadge: {
      borderWidth: 1,
      borderRadius: Layout.radius.sm,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    typeBadgeText: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
    },
    textDisabled: {
      color: colors.textMuted,
    },
    periodMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    },
    timeTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    timeTagText: {
      color: colors.textMuted,
      fontSize: 12,
      fontVariant: ['tabular-nums'],
    },
    dayTag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: 10,
    },
    dayTagCustom: {
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.15)' : 'rgba(220, 38, 38, 0.1)',
      borderWidth: 0.5,
      borderColor: isDark ? 'rgba(239, 68, 68, 0.3)' : 'rgba(220, 38, 38, 0.25)',
    },
    dayTagText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '500',
    },
    dayTagTextCustom: {
      color: isDark ? '#FCA5A5' : '#DC2626',
      fontWeight: '700',
    },
    periodBottomRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: 2,
    },
    chimeBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.1)' : 'rgba(217, 119, 6, 0.08)',
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: Layout.radius.sm,
      borderWidth: 0.5,
      borderColor: isDark ? 'rgba(253, 168, 58, 0.25)' : 'rgba(217, 119, 6, 0.2)',
      maxWidth: '75%',
    },
    chimeBadgeText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '600',
    },
    periodActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    actionBtn: {
      padding: 2,
    },
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 16,
    },
    modalDismissArea: {
      width: '100%',
      maxWidth: 480,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalContent: {
      width: '100%',
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 20,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      maxHeight: '90%',
    },
    modalHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      marginBottom: 14,
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    modalSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    modalScroll: {
      maxHeight: 460,
    },
    inputLabel: {
      color: colors.textMuted,
      fontSize: 12,
      fontWeight: '600',
      marginBottom: 4,
      textTransform: 'uppercase',
      letterSpacing: 0.5,
    },
    inputSubLabel: {
      color: colors.textMuted,
      fontSize: 11,
      marginBottom: 8,
    },
    textInput: {
      backgroundColor: colors.inputBackground,
      borderRadius: Layout.radius.md,
      padding: 12,
      color: colors.text,
      fontSize: 14,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      marginBottom: 12,
    },
    timePickerBoxesRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginBottom: 14,
      gap: 8,
    },
    timeSetterBox: {
      flex: 1,
      backgroundColor: colors.inputBackground,
      borderRadius: Layout.radius.md,
      padding: 14,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    timeSetterBoxHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      marginBottom: 6,
    },
    timeSetterBoxTitle: {
      fontSize: 10,
      fontWeight: '700',
      letterSpacing: 0.5,
      color: colors.textMuted,
    },
    timeDisplayBig: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
    },
    timeDisplaySub: {
      color: colors.textMuted,
      fontSize: 11,
      marginTop: 3,
      marginBottom: 0,
    },
    timeArrowDivider: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 2,
    },
    typeSelectorRow: {
      flexDirection: 'row',
      gap: 8,
      marginBottom: 16,
    },
    typePill: {
      flex: 1,
      paddingVertical: 8,
      borderRadius: Layout.radius.md,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
    },
    typePillActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      borderColor: colors.primary,
    },
    typePillText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    typePillTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    modalSectionHeader: {
      marginBottom: 4,
    },
    modalChimeGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginBottom: 12,
    },
    modalChimeCard: {
      width: '48.5%',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.03)' : colors.cardSecondary,
      borderRadius: Layout.radius.md,
      padding: 10,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      gap: 3,
    },
    modalChimeCardActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.1)' : 'rgba(217, 119, 6, 0.1)',
      borderColor: colors.primary,
    },
    modalChimeName: {
      color: colors.text,
      fontSize: 11,
      fontWeight: '600',
    },
    modalChimeNameActive: {
      color: colors.primary,
    },
    chimePlayMini: {
      padding: 2,
    },
    quickPresetRow: {
      flexDirection: 'row',
      gap: 6,
      marginBottom: 8,
    },
    presetChip: {
      flex: 1,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
    },
    presetChipActive: {
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      borderColor: colors.primary,
    },
    presetChipText: {
      color: colors.textMuted,
      fontSize: 10,
      fontWeight: '600',
    },
    presetChipTextActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    modalDaysRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      marginBottom: 12,
    },
    modalDayPill: {
      width: 36,
      height: 32,
      borderRadius: Layout.radius.sm,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalDayPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    modalDayPillCustom: {
      backgroundColor: isDark ? '#DC2626' : '#EF4444',
      borderColor: isDark ? '#DC2626' : '#EF4444',
    },
    modalDayPillText: {
      color: colors.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    modalDayPillTextActive: {
      color: '#FFFFFF',
      fontWeight: '700',
    },
    modalBtnRow: {
      flexDirection: 'row',
      gap: 10,
      marginTop: 8,
    },
    modalCancelBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: Layout.radius.md,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : colors.cardSecondary,
      alignItems: 'center',
    },
    modalCancelBtnText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    modalSaveBtn: {
      flex: 1,
      paddingVertical: 12,
      borderRadius: Layout.radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
    },
    modalSaveBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
    modalDoneBtn: {
      width: '100%',
      paddingVertical: 12,
      borderRadius: Layout.radius.md,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 8,
    },
    modalDoneBtnText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
