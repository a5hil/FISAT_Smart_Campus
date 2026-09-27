import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Switch, Modal, TextInput, Alert as RNAlert, Platform
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { useApp } from '../context/AppContext';
import { TimetableConfig, TimetablePeriod, BellPattern } from '../types';

const DAYS = [
  { day: 1, label: 'Mon' },
  { day: 2, label: 'Tue' },
  { day: 3, label: 'Wed' },
  { day: 4, label: 'Thu' },
  { day: 5, label: 'Fri' },
  { day: 6, label: 'Sat' },
  { day: 0, label: 'Sun' },
];

const BELL_PATTERNS: { id: BellPattern; name: string; desc: string; icon: string }[] = [
  { id: 'college-bell', name: 'College Bell', desc: '3 Long Classic Rings', icon: 'notifications' },
  { id: 'triple-chime', name: 'Triple Chime', desc: '3 Gentle Beeps', icon: 'musical-notes' },
  { id: 'double-beep', name: 'Double Beep', desc: '2 Crisp Alert Beeps', icon: 'flash' },
  { id: 'single-long', name: 'Single Long', desc: '1 Solid 1.0s Bell', icon: 'volume-high' },
];

export default function TimetableScreen() {
  const router = useRouter();
  const { timetable, updateTimetable, triggerBellTest, esp32Connected } = useApp();

  const [activeConfig, setActiveConfig] = useState<TimetableConfig>(timetable);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingPeriodId, setEditingPeriodId] = useState<string | null>(null);
  const [periodName, setPeriodName] = useState('');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:00');
  const [periodType, setPeriodType] = useState<'class' | 'break' | 'lunch' | 'lab'>('class');
  const [testingBell, setTestingBell] = useState(false);

  // Sync state if context updates
  useEffect(() => {
    setActiveConfig(timetable);
  }, [timetable]);

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

      // Find current period
      let foundCurrent: TimetablePeriod | null = null;
      let foundNext: TimetablePeriod | null = null;
      let minDiff: number | null = null;

      for (const p of activeConfig.periods) {
        if (!p.enabled) continue;
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
    const updated = { ...activeConfig, enabled: val };
    setActiveConfig(updated);
    void updateTimetable(updated);
  };

  const handleToggleDay = (day: number) => {
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
    const updated = { ...activeConfig, defaultPattern: pattern };
    setActiveConfig(updated);
    void updateTimetable(updated);
  };

  const handleTogglePeriod = (id: string) => {
    const updatedPeriods = activeConfig.periods.map(p => p.id === id ? { ...p, enabled: !p.enabled } : p);
    const updated = { ...activeConfig, periods: updatedPeriods };
    setActiveConfig(updated);
    void updateTimetable(updated);
  };

  const handleTestBell = async () => {
    setTestingBell(true);
    await triggerBellTest(activeConfig.defaultPattern);
    setTestingBell(false);
  };

  const openAddModal = () => {
    setEditingPeriodId(null);
    setPeriodName(`Period ${activeConfig.periods.filter(p => p.type === 'class').length + 1}`);
    setStartTime('09:00');
    setEndTime('10:00');
    setPeriodType('class');
    setModalVisible(true);
  };

  const openEditModal = (p: TimetablePeriod) => {
    setEditingPeriodId(p.id);
    setPeriodName(p.name);
    setStartTime(p.startTime);
    setEndTime(p.endTime);
    setPeriodType(p.type);
    setModalVisible(true);
  };

  const handleSavePeriod = () => {
    if (!periodName.trim()) {
      RNAlert.alert('Required', 'Please enter a period title.');
      return;
    }
    if (!startTime.includes(':') || !endTime.includes(':')) {
      RNAlert.alert('Invalid Format', 'Please enter time in HH:mm format (e.g. 09:00).');
      return;
    }

    let updatedPeriods = [...activeConfig.periods];
    if (editingPeriodId) {
      updatedPeriods = updatedPeriods.map(p => p.id === editingPeriodId ? {
        ...p,
        name: periodName.trim(),
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        type: periodType,
      } : p);
    } else {
      const newP: TimetablePeriod = {
        id: `p-${Date.now()}`,
        name: periodName.trim(),
        startTime: startTime.trim(),
        endTime: endTime.trim(),
        type: periodType,
        enabled: true,
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

  const handleDeletePeriod = (id: string) => {
    RNAlert.alert(
      'Delete Period',
      'Are you sure you want to remove this period from the schedule?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
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
      case 'break': return Colors.warning;
      case 'lunch': return Colors.success;
      case 'lab': return '#9B51E0';
      default: return Colors.primary;
    }
  };

  return (
    <View style={styles.container}>
      {/* Screen Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <View style={styles.headerTextContainer}>
          <Text style={styles.headerTitle}>Class Timetable & Bell</Text>
          <Text style={styles.headerSubtitle}>FISAT Automated Period Schedule</Text>
        </View>
        <TouchableOpacity style={styles.addIconButton} onPress={openAddModal}>
          <Ionicons name="add" size={24} color={Colors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* Live Period Status Card */}
        <View style={styles.liveCard}>
          <View style={styles.liveHeaderRow}>
            <View style={styles.liveBadgeRow}>
              <View style={[styles.liveDot, { backgroundColor: currentPeriod ? Colors.success : Colors.textMuted }]} />
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
              <View style={styles.countdownBadge}>
                <Ionicons name="alarm-outline" size={16} color={Colors.primary} />
                <Text style={styles.countdownText}>
                  Hour ends in {minutesRemaining} min{minutesRemaining === 1 ? '' : 's'} (Buzzer will ring)
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
              <Ionicons name="notifications" size={20} color={Colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.sectionTitle}>Automated Period Bell</Text>
              <Text style={styles.sectionSubtitle}>Beeps 3V buzzer when each hour is over</Text>
            </View>
            <Switch
              value={activeConfig.enabled}
              onValueChange={handleToggleMaster}
              trackColor={{ false: 'rgba(255, 255, 255, 0.15)', true: Colors.primary }}
              thumbColor={activeConfig.enabled ? '#FFF' : '#DDD'}
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

          {/* Chime Pattern Options */}
          <View style={styles.patternHeaderRow}>
            <Text style={styles.subLabel}>Period End Bell Tone</Text>
            <TouchableOpacity
              style={styles.testBellBtn}
              onPress={handleTestBell}
              disabled={testingBell}
              activeOpacity={0.7}
            >
              <Ionicons name="volume-medium-outline" size={15} color={Colors.primary} />
              <Text style={styles.testBellBtnText}>
                {testingBell ? 'Ringing...' : 'Test Bell'}
              </Text>
            </TouchableOpacity>
          </View>

          <View style={styles.patternGrid}>
            {BELL_PATTERNS.map(pat => {
              const selected = activeConfig.defaultPattern === pat.id;
              return (
                <TouchableOpacity
                  key={pat.id}
                  style={[styles.patternCard, selected && styles.patternCardActive]}
                  onPress={() => handleSelectPattern(pat.id)}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name={pat.icon as any}
                    size={18}
                    color={selected ? Colors.primary : Colors.textMuted}
                  />
                  <Text style={[styles.patternName, selected && styles.patternNameActive]}>
                    {pat.name}
                  </Text>
                  <Text style={styles.patternDesc}>{pat.desc}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* Schedule List Section */}
        <View style={styles.scheduleHeaderRow}>
          <Text style={styles.scheduleSectionTitle}>
            Daily Schedule ({activeConfig.periods.length} Periods)
          </Text>
          <TouchableOpacity style={styles.addTextBtn} onPress={openAddModal}>
            <Ionicons name="add-circle-outline" size={16} color={Colors.primary} />
            <Text style={styles.addTextBtnLabel}>Add Period</Text>
          </TouchableOpacity>
        </View>

        {activeConfig.periods.map((p, idx) => {
          const typeColor = getTypeColor(p.type);
          return (
            <View key={p.id} style={[styles.periodCard, !p.enabled && styles.periodCardDisabled]}>
              <View style={[styles.periodTypeBar, { backgroundColor: typeColor }]} />
              
              <View style={styles.periodContent}>
                <View style={styles.periodTopRow}>
                  <View style={styles.periodTitleRow}>
                    <Text style={[styles.periodNameText, !p.enabled && styles.textDisabled]}>
                      {p.name}
                    </Text>
                    <View style={[styles.typeBadge, { borderColor: typeColor }]}>
                      <Text style={[styles.typeBadgeText, { color: typeColor }]}>
                        {p.type.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <Switch
                    value={p.enabled}
                    onValueChange={() => handleTogglePeriod(p.id)}
                    trackColor={{ false: 'rgba(255, 255, 255, 0.12)', true: Colors.primary }}
                    thumbColor={p.enabled ? '#FFF' : '#AAA'}
                    style={{ transform: [{ scale: 0.85 }] }}
                  />
                </View>

                <View style={styles.periodBottomRow}>
                  <View style={styles.timeTag}>
                    <Ionicons name="time-outline" size={14} color={Colors.textMuted} />
                    <Text style={styles.timeTagText}>
                      {p.startTime} — {p.endTime}
                    </Text>
                  </View>

                  <View style={styles.periodActions}>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => openEditModal(p)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="pencil-outline" size={16} color={Colors.textMuted} />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.actionBtn}
                      onPress={() => handleDeletePeriod(p.id)}
                      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    >
                      <Ionicons name="trash-outline" size={16} color={Colors.critical} />
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </View>
          );
        })}

        <View style={{ height: 60 }} />
      </ScrollView>

      {/* Add / Edit Period Modal */}
      <Modal visible={modalVisible} transparent animationType="fade">
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                {editingPeriodId ? 'Edit Period' : 'Add Schedule Period'}
              </Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Ionicons name="close" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>

            <Text style={styles.inputLabel}>Period Title</Text>
            <TextInput
              style={styles.textInput}
              placeholder="e.g. Period 1, Tea Break, Lab Session"
              placeholderTextColor={Colors.textMuted}
              value={periodName}
              onChangeText={setPeriodName}
            />

            <View style={styles.timeInputRow}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={styles.inputLabel}>Start Time (HH:mm)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="09:00"
                  placeholderTextColor={Colors.textMuted}
                  value={startTime}
                  onChangeText={setStartTime}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={styles.inputLabel}>End Time (HH:mm)</Text>
                <TextInput
                  style={styles.textInput}
                  placeholder="10:00"
                  placeholderTextColor={Colors.textMuted}
                  value={endTime}
                  onChangeText={setEndTime}
                  keyboardType="numbers-and-punctuation"
                />
              </View>
            </View>

            <Text style={styles.inputLabel}>Period Type</Text>
            <View style={styles.typeSelectorRow}>
              {(['class', 'break', 'lunch', 'lab'] as const).map(t => (
                <TouchableOpacity
                  key={t}
                  style={[styles.typePill, periodType === t && styles.typePillActive]}
                  onPress={() => setPeriodType(t)}
                >
                  <Text style={[styles.typePillText, periodType === t && styles.typePillTextActive]}>
                    {t.toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={styles.modalBtnRow}>
              <TouchableOpacity
                style={styles.modalCancelBtn}
                onPress={() => setModalVisible(false)}
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
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Layout.spacing.md,
    paddingTop: Platform.OS === 'ios' ? 54 : 44,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceTranslucent,
  },
  backButton: {
    padding: 8,
    marginRight: 6,
  },
  headerTextContainer: {
    flex: 1,
  },
  headerTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  headerSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  addIconButton: {
    padding: 8,
  },
  scrollContent: {
    padding: Layout.spacing.md,
  },
  liveCard: {
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(253, 168, 58, 0.3)',
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
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  liveTime: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  currentPeriodInfo: {
    gap: 4,
  },
  currentPeriodName: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '700',
  },
  currentPeriodTime: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  countdownBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(253, 168, 58, 0.1)',
    borderRadius: Layout.radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  countdownText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  idlePeriodInfo: {
    gap: 4,
  },
  idleTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  idleSub: {
    color: Colors.textMuted,
    fontSize: 13,
  },
  sectionCard: {
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
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
    backgroundColor: 'rgba(253, 168, 58, 0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  sectionSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
  },
  subLabel: {
    color: Colors.textMuted,
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
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayPillActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  dayPillText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  dayPillTextActive: {
    color: '#000',
    fontWeight: '700',
  },
  patternHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  testBellBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: Layout.radius.sm,
    backgroundColor: 'rgba(253, 168, 58, 0.12)',
  },
  testBellBtnText: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  patternGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  patternCard: {
    width: '48%',
    backgroundColor: 'rgba(255, 255, 255, 0.03)',
    borderRadius: Layout.radius.md,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    gap: 4,
  },
  patternCardActive: {
    backgroundColor: 'rgba(253, 168, 58, 0.08)',
    borderColor: Colors.primary,
  },
  patternName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  patternNameActive: {
    color: Colors.primary,
  },
  patternDesc: {
    color: Colors.textMuted,
    fontSize: 11,
  },
  scheduleHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  scheduleSectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  addTextBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  addTextBtnLabel: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  periodCard: {
    flexDirection: 'row',
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.md,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
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
  },
  periodNameText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
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
    color: Colors.textMuted,
  },
  periodBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timeTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeTagText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
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
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    width: '100%',
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
  },
  inputLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  textInput: {
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderRadius: Layout.radius.md,
    padding: 12,
    color: Colors.text,
    fontSize: 14,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
    marginBottom: 14,
  },
  timeInputRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  typeSelectorRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  typePill: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: Layout.radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  typePillActive: {
    backgroundColor: 'rgba(253, 168, 58, 0.15)',
    borderColor: Colors.primary,
  },
  typePillText: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
  },
  typePillTextActive: {
    color: Colors.primary,
    fontWeight: '700',
  },
  modalBtnRow: {
    flexDirection: 'row',
    gap: 10,
  },
  modalCancelBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Layout.radius.md,
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
  },
  modalCancelBtnText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  modalSaveBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: Layout.radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
  },
  modalSaveBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
});
