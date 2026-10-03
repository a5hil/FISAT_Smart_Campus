import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TouchableWithoutFeedback,
  FlatList,
  Platform,
  NativeSyntheticEvent,
  NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient as SvgGradient, Stop, Rect } from 'react-native-svg';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../context/AppContext';

const triggerHaptic = () => {
  try {
    Haptics.selectionAsync().catch(() => {});
  } catch {
    // Graceful fallback if unsupported
  }
};

const ITEM_HEIGHT = 48; // Generous height prevents vertical font ascender/descender clipping
const VISIBLE_ITEMS = 5; // 2 above, 1 selected in center, 2 below
const WHEEL_HEIGHT = ITEM_HEIGHT * VISIBLE_ITEMS; // 240px
const LENS_TOP = ITEM_HEIGHT * 2; // 96px

const HOURS = Array.from({ length: 12 }, (_, i) => i + 1); // 1 to 12
const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 0 to 59
const PERIODS = ['AM', 'PM'] as const;

function parseTime24h(timeStr?: string) {
  const parts = (timeStr || '08:30').split(':');
  const h24 = parseInt(parts[0] || '8', 10);
  const m = Math.max(0, Math.min(59, parseInt(parts[1] || '30', 10)));

  const isPM = h24 >= 12;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12; // 1 to 12
  const hIdx = HOURS.indexOf(h12);

  return {
    hourIndex: hIdx >= 0 ? hIdx : 7,
    minuteIndex: m,
    periodIndex: isPM ? 1 : 0,
  };
}

interface DrumWheelColumnProps<T> {
  data: readonly T[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  renderLabel: (item: T) => string;
  width?: number;
  colors: any;
  isDark: boolean;
}

function DrumWheelColumn<T>({
  data,
  selectedIndex,
  onSelect,
  renderLabel,
  width = 84,
  colors,
}: DrumWheelColumnProps<T>) {
  const listRef = useRef<FlatList>(null);
  const isUserInteractingRef = useRef(false);
  const isProgrammaticScrollRef = useRef(false);
  const programmaticScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastCommittedIndexRef = useRef(selectedIndex);
  const lastReportedIndexRef = useRef(selectedIndex);
  const isFirstMountRef = useRef(true);

  useEffect(() => {
    return () => {
      if (programmaticScrollTimerRef.current) {
        clearTimeout(programmaticScrollTimerRef.current);
      }
    };
  }, []);

  // Sync scroll position ONLY when selectedIndex changes externally (e.g. quick nudge chips or user tap)
  // NEVER fight the user's natural finger drag or momentum animation!
  useEffect(() => {
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      lastCommittedIndexRef.current = selectedIndex;
      lastReportedIndexRef.current = selectedIndex;
      listRef.current?.scrollToOffset({
        offset: selectedIndex * ITEM_HEIGHT,
        animated: false,
      });
      return;
    }

    if (!isUserInteractingRef.current && lastCommittedIndexRef.current !== selectedIndex) {
      lastCommittedIndexRef.current = selectedIndex;
      lastReportedIndexRef.current = selectedIndex;
      isProgrammaticScrollRef.current = true;
      listRef.current?.scrollToOffset({
        offset: selectedIndex * ITEM_HEIGHT,
        animated: true,
      });

      if (programmaticScrollTimerRef.current) clearTimeout(programmaticScrollTimerRef.current);
      programmaticScrollTimerRef.current = setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 400);
    }
  }, [selectedIndex]);

  // Initial mount: ensure immediate static positioning with zero rolling
  useEffect(() => {
    listRef.current?.scrollToOffset({
      offset: selectedIndex * ITEM_HEIGHT,
      animated: false,
    });
  }, []);

  const handleScrollBeginDrag = () => {
    if (programmaticScrollTimerRef.current) clearTimeout(programmaticScrollTimerRef.current);
    isProgrammaticScrollRef.current = false;
    isUserInteractingRef.current = true;
  };

  const handleMomentumScrollBegin = () => {
    isUserInteractingRef.current = true;
  };

  // Live real-time responsive sync as the wheel rolls
  const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    // When the wheel is smoothly animating from a nudge tap, don't interrupt with intermediate events
    if (isProgrammaticScrollRef.current) return;

    const y = e.nativeEvent.contentOffset.y;
    const rawIdx = Math.round(y / ITEM_HEIGHT);
    const clampedIdx = Math.max(0, Math.min(data.length - 1, rawIdx));
    if (clampedIdx !== lastReportedIndexRef.current) {
      lastReportedIndexRef.current = clampedIdx;
      lastCommittedIndexRef.current = clampedIdx;
      triggerHaptic();
      onSelect(clampedIdx);
    }
  };

  const handleMomentumScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    isProgrammaticScrollRef.current = false;
    isUserInteractingRef.current = false;
    const y = e.nativeEvent.contentOffset.y;
    const rawIdx = Math.round(y / ITEM_HEIGHT);
    const clampedIdx = Math.max(0, Math.min(data.length - 1, rawIdx));
    if (clampedIdx !== lastReportedIndexRef.current) {
      triggerHaptic();
    }
    lastCommittedIndexRef.current = clampedIdx;
    lastReportedIndexRef.current = clampedIdx;
    onSelect(clampedIdx);
  };

  const handleScrollEndDrag = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const velocity = Math.abs(e.nativeEvent.velocity?.y ?? 0);
    if (velocity < 0.08) {
      const y = e.nativeEvent.contentOffset.y;
      const rawIdx = Math.round(y / ITEM_HEIGHT);
      const clampedIdx = Math.max(0, Math.min(data.length - 1, rawIdx));
      if (clampedIdx !== lastReportedIndexRef.current) {
        triggerHaptic();
      }
      lastCommittedIndexRef.current = clampedIdx;
      lastReportedIndexRef.current = clampedIdx;
      isUserInteractingRef.current = false;
      isProgrammaticScrollRef.current = false;
      listRef.current?.scrollToOffset({
        offset: clampedIdx * ITEM_HEIGHT,
        animated: true,
      });
      onSelect(clampedIdx);
    }
  };

  const handleItemPress = (index: number) => {
    if (index === selectedIndex) return;
    isUserInteractingRef.current = false;
    isProgrammaticScrollRef.current = true;
    lastCommittedIndexRef.current = index;
    lastReportedIndexRef.current = index;
    triggerHaptic();
    listRef.current?.scrollToOffset({
      offset: index * ITEM_HEIGHT,
      animated: true,
    });
    if (programmaticScrollTimerRef.current) clearTimeout(programmaticScrollTimerRef.current);
    programmaticScrollTimerRef.current = setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 400);
    onSelect(index);
  };

  return (
    <View style={[styles.columnWrapper, { width }]}>
      <FlatList
        ref={listRef}
        data={data as any}
        keyExtractor={(_, i) => String(i)}
        showsVerticalScrollIndicator={false}
        nestedScrollEnabled={true}
        overScrollMode="never"
        scrollEventThrottle={16}
        contentOffset={{ x: 0, y: selectedIndex * ITEM_HEIGHT }}
        snapToInterval={ITEM_HEIGHT}
        snapToAlignment="start"
        decelerationRate={Platform.OS === 'ios' ? 'fast' : 0.92}
        getItemLayout={(_, index) => ({
          length: ITEM_HEIGHT,
          offset: ITEM_HEIGHT * index,
          index,
        })}
        onScroll={handleScroll}
        onScrollBeginDrag={handleScrollBeginDrag}
        onMomentumScrollBegin={handleMomentumScrollBegin}
        onScrollEndDrag={handleScrollEndDrag}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        ListHeaderComponent={<View style={{ height: ITEM_HEIGHT * 2 }} />}
        ListFooterComponent={<View style={{ height: ITEM_HEIGHT * 2 }} />}
        initialNumToRender={15}
        maxToRenderPerBatch={25}
        windowSize={9}
        renderItem={({ item, index }) => {
          const isSelected = index === selectedIndex;
          const distance = Math.abs(index - selectedIndex);
          const opacity = isSelected ? 1 : distance === 1 ? 0.45 : 0.18;
          const fontSize = isSelected ? 25 : distance === 1 ? 18 : 15;

          return (
            <TouchableOpacity
              style={[styles.wheelItem, { height: ITEM_HEIGHT }]}
              activeOpacity={0.7}
              onPress={() => handleItemPress(index)}
            >
              <Text
                style={[
                  styles.wheelItemText,
                  {
                    color: isSelected ? colors.primary : colors.text,
                    opacity,
                    fontSize,
                    fontWeight: isSelected ? '800' : distance === 1 ? '600' : '500',
                  },
                ]}
                numberOfLines={1}
              >
                {renderLabel(item)}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

export interface DrumTimePickerModalProps {
  visible: boolean;
  initialTime?: string; // "HH:mm" in 24h format (e.g. "08:30" or "17:00")
  title?: string;
  subtitle?: string;
  target?: 'on' | 'off';
  onConfirm: (time24h: string) => void;
  onCancel: () => void;
}

export function DrumTimePickerModal({
  visible,
  initialTime = '08:30',
  title,
  subtitle,
  target = 'on',
  onConfirm,
  onCancel,
}: DrumTimePickerModalProps) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  // Internal state: initialized directly with parsed initialTime so the very first render already holds the exact set time!
  const initialParsed = useMemo(() => parseTime24h(initialTime), [initialTime]);
  const [selectedHourIndex, setSelectedHourIndex] = useState(initialParsed.hourIndex);
  const [selectedMinuteIndex, setSelectedMinuteIndex] = useState(initialParsed.minuteIndex);
  const [selectedPeriodIndex, setSelectedPeriodIndex] = useState(initialParsed.periodIndex);

  // Sync state whenever modal opens or initialTime changes
  useEffect(() => {
    if (visible) {
      const parsed = parseTime24h(initialTime);
      setSelectedHourIndex(parsed.hourIndex);
      setSelectedMinuteIndex(parsed.minuteIndex);
      setSelectedPeriodIndex(parsed.periodIndex);
    }
  }, [visible, initialTime]);

  const currentHour = HOURS[selectedHourIndex] ?? 8;
  const currentMinute = MINUTES[selectedMinuteIndex] ?? 30;
  const currentPeriod = PERIODS[selectedPeriodIndex] ?? 'AM';

  // Compute 24h time representation
  const computed24h = useMemo(() => {
    let h = currentHour % 12;
    if (currentPeriod === 'PM') h += 12;
    const hh = String(h).padStart(2, '0');
    const mm = String(currentMinute).padStart(2, '0');
    return `${hh}:${mm}`;
  }, [currentHour, currentMinute, currentPeriod]);

  // Quick Adjustment Nudges
  const nudgeTime = (deltaMins: number) => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } catch {}
    let totalMins = currentHour % 12;
    if (currentPeriod === 'PM') totalMins += 12;
    totalMins = totalMins * 60 + currentMinute + deltaMins;

    // Wrap around 24 hours (1440 minutes)
    totalMins = (totalMins % 1440 + 1440) % 1440;

    const newH24 = Math.floor(totalMins / 60);
    const newM = totalMins % 60;
    const isPM = newH24 >= 12;
    const newH12 = newH24 % 12 === 0 ? 12 : newH24 % 12;

    const hIdx = HOURS.indexOf(newH12);
    if (hIdx >= 0) setSelectedHourIndex(hIdx);
    setSelectedMinuteIndex(newM);
    setSelectedPeriodIndex(isPM ? 1 : 0);
  };

  const handleConfirm = () => {
    onConfirm(computed24h);
  };

  if (!visible) return null;

  const defaultTitle = target === 'on' ? 'Schedule Power ON' : 'Schedule Power OFF';
  const displayTitle = title || defaultTitle;
  const displaySub = subtitle || (target === 'on' ? 'Appliance automatically turns ON at set time' : 'Appliance automatically turns OFF at set time');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
      statusBarTranslucent
    >
      <TouchableWithoutFeedback onPress={onCancel}>
        <View style={styles.modalOverlay}>
          <TouchableWithoutFeedback onPress={(e) => e.stopPropagation()}>
            <View
              style={[
                styles.modalContainer,
                {
                  backgroundColor: isDark ? '#12141C' : '#FFFFFF',
                  borderColor: isDark ? 'rgba(255, 255, 255, 0.10)' : 'rgba(0, 0, 0, 0.08)',
                  paddingBottom: Math.max(20, insets.bottom + 12),
                },
              ]}
            >
              {/* Grab Handle */}
              <View style={styles.grabHandleRow}>
                <View style={[styles.grabHandle, { backgroundColor: isDark ? 'rgba(255,255,255,0.22)' : 'rgba(0,0,0,0.18)' }]} />
              </View>

              {/* Header Title & Info */}
              <View style={styles.header}>
                <View style={styles.headerIconBox}>
                  <Ionicons
                    name={target === 'on' ? 'power' : 'power-outline'}
                    size={20}
                    color={target === 'on' ? colors.success : colors.critical}
                  />
                </View>
                <View style={styles.headerTextGroup}>
                  <Text style={[styles.title, { color: colors.text }]}>{displayTitle}</Text>
                  <Text style={[styles.subtitle, { color: colors.textMuted }]} numberOfLines={1}>
                    {displaySub}
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={onCancel}
                  style={[styles.closeBtn, { backgroundColor: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.04)' }]}
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>

              {/* Digital Time Hero Readout */}
              <View
                style={[
                  styles.digitalTimeHero,
                  {
                    backgroundColor: isDark ? 'rgba(255, 255, 255, 0.035)' : 'rgba(0, 0, 0, 0.025)',
                    borderColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.07)',
                  },
                ]}
              >
                <View style={styles.digitalTimeRow}>
                  <Text style={[styles.digitalTimeDigit, { color: colors.text }]}>
                    {String(currentHour).padStart(2, '0')}
                  </Text>
                  <Text style={[styles.digitalTimeColon, { color: colors.primary }]}>:</Text>
                  <Text style={[styles.digitalTimeDigit, { color: colors.text }]}>
                    {String(currentMinute).padStart(2, '0')}
                  </Text>
                  <TouchableOpacity
                    style={[styles.periodBadge, { backgroundColor: colors.primary + '22' }]}
                    onPress={() => setSelectedPeriodIndex(prev => (prev === 0 ? 1 : 0))}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.periodBadgeText, { color: colors.primary }]}>
                      {currentPeriod}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.militarySubtext, { color: colors.textMuted }]}>
                  {computed24h} (24-Hour System Format)
                </Text>
              </View>

              {/* Drum Wheels Selection Stage */}
              <View style={styles.wheelStage}>
                {/* Center Selection Lens Overlay (Spans all columns with high visibility and room for text) */}
                <View
                  pointerEvents="none"
                  style={[
                    styles.centerLens,
                    {
                      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
                      borderColor: isDark ? 'rgba(253, 168, 58, 0.45)' : 'rgba(217, 119, 6, 0.38)',
                    },
                  ]}
                />

                {/* 3 Drum Columns with generous width and spacing */}
                <View style={styles.wheelColumnsContainer}>
                  {/* Hours Wheel */}
                  <DrumWheelColumn
                    data={HOURS}
                    selectedIndex={selectedHourIndex}
                    onSelect={setSelectedHourIndex}
                    renderLabel={(h) => String(h).padStart(2, '0')}
                    width={86}
                    colors={colors}
                    isDark={isDark}
                  />

                  {/* Divider Colon */}
                  <View style={styles.colonSeparatorBox}>
                    <Text style={[styles.colonSeparatorText, { color: colors.primary }]}>:</Text>
                  </View>

                  {/* Minutes Wheel */}
                  <DrumWheelColumn
                    data={MINUTES}
                    selectedIndex={selectedMinuteIndex}
                    onSelect={setSelectedMinuteIndex}
                    renderLabel={(m) => String(m).padStart(2, '0')}
                    width={86}
                    colors={colors}
                    isDark={isDark}
                  />

                  {/* AM / PM Wheel */}
                  <DrumWheelColumn
                    data={PERIODS}
                    selectedIndex={selectedPeriodIndex}
                    onSelect={setSelectedPeriodIndex}
                    renderLabel={(p) => p}
                    width={78}
                    colors={colors}
                    isDark={isDark}
                  />
                </View>

                {/* Top Vignette Fade (Height 76px so it never overlays or clips center selected numbers) */}
                <View pointerEvents="none" style={styles.topVignette}>
                  <Svg width="100%" height={76}>
                    <Defs>
                      <SvgGradient id="topFade" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor={isDark ? '#12141C' : '#FFFFFF'} stopOpacity="0.98" />
                        <Stop offset="0.6" stopColor={isDark ? '#12141C' : '#FFFFFF'} stopOpacity="0.65" />
                        <Stop offset="0.9" stopColor={isDark ? '#12141C' : '#FFFFFF'} stopOpacity="0.1" />
                        <Stop offset="1" stopColor={isDark ? '#12141C' : '#FFFFFF'} stopOpacity="0" />
                      </SvgGradient>
                    </Defs>
                    <Rect width="100%" height={76} fill="url(#topFade)" />
                  </Svg>
                </View>

                {/* Bottom Vignette Fade (Height 76px so it never overlays or clips center selected numbers) */}
                <View pointerEvents="none" style={styles.bottomVignette}>
                  <Svg width="100%" height={76}>
                    <Defs>
                      <SvgGradient id="bottomFade" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0" stopColor={isDark ? '#12141C' : '#FFFFFF'} stopOpacity="0" />
                        <Stop offset="0.1" stopColor={isDark ? '#12141C' : '#FFFFFF'} stopOpacity="0.1" />
                        <Stop offset="0.4" stopColor={isDark ? '#12141C' : '#FFFFFF'} stopOpacity="0.65" />
                        <Stop offset="1" stopColor={isDark ? '#12141C' : '#FFFFFF'} stopOpacity="0.98" />
                      </SvgGradient>
                    </Defs>
                    <Rect width="100%" height={76} fill="url(#bottomFade)" />
                  </Svg>
                </View>
              </View>

              {/* Quick Nudge Adjustment Chips */}
              <View style={styles.nudgeRow}>
                {[
                  { label: '-15m', delta: -15 },
                  { label: '+15m', delta: 15 },
                  { label: '+30m', delta: 30 },
                  { label: '+1h', delta: 60 },
                ].map((chip) => (
                  <TouchableOpacity
                    key={chip.label}
                    style={[
                      styles.nudgeChip,
                      {
                        backgroundColor: isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.04)',
                        borderColor: isDark ? 'rgba(255, 255, 255, 0.09)' : 'rgba(0, 0, 0, 0.08)',
                      },
                    ]}
                    onPress={() => nudgeTime(chip.delta)}
                    activeOpacity={0.7}
                  >
                    <Ionicons
                      name={chip.delta < 0 ? 'arrow-back-outline' : 'arrow-forward-outline'}
                      size={11}
                      color={colors.primary}
                    />
                    <Text style={[styles.nudgeChipText, { color: colors.textSecondary }]}>
                      {chip.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Action Buttons */}
              <View style={styles.actionRow}>
                <TouchableOpacity
                  style={[
                    styles.cancelBtn,
                    {
                      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : 'rgba(0, 0, 0, 0.05)',
                    },
                  ]}
                  onPress={onCancel}
                  activeOpacity={0.75}
                >
                  <Text style={[styles.cancelBtnText, { color: colors.textSecondary }]}>Cancel</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.confirmBtn,
                    {
                      backgroundColor: colors.primary,
                      shadowColor: colors.primary,
                    },
                  ]}
                  onPress={handleConfirm}
                  activeOpacity={0.85}
                >
                  <Ionicons name="checkmark-sharp" size={18} color="#FFFFFF" />
                  <Text style={styles.confirmBtnText}>Confirm Time</Text>
                </TouchableOpacity>
              </View>
            </View>
          </TouchableWithoutFeedback>
        </View>
      </TouchableWithoutFeedback>
    </Modal>
  );
}

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    borderWidth: 1,
    borderBottomWidth: 0,
    paddingHorizontal: 20,
    paddingTop: 10,
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 24,
  },
  grabHandleRow: {
    alignItems: 'center',
    paddingVertical: 6,
  },
  grabHandle: {
    width: 38,
    height: 4.5,
    borderRadius: 3,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.06)',
  },
  headerIconBox: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  headerTextGroup: {
    flex: 1,
  },
  title: {
    fontSize: 16,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 12,
    marginTop: 2,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  digitalTimeHero: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 16,
    borderWidth: 1,
    marginTop: 12,
    marginBottom: 6,
  },
  digitalTimeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  digitalTimeDigit: {
    fontSize: 32,
    fontWeight: '800',
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  digitalTimeColon: {
    fontSize: 30,
    fontWeight: '800',
    marginHorizontal: 3,
    marginBottom: 2,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  periodBadge: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 8,
    marginLeft: 10,
  },
  periodBadgeText: {
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  militarySubtext: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: 3,
  },
  wheelStage: {
    height: WHEEL_HEIGHT,
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
    marginVertical: 4,
  },
  centerLens: {
    position: 'absolute',
    left: 12,
    right: 12,
    top: LENS_TOP,
    height: ITEM_HEIGHT,
    borderRadius: 14,
    borderWidth: 1.5,
    zIndex: 1,
  },
  wheelColumnsContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    height: WHEEL_HEIGHT,
    width: '100%',
    zIndex: 2,
  },
  columnWrapper: {
    height: WHEEL_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wheelItem: {
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  wheelItemText: {
    fontVariant: ['tabular-nums'],
    textAlign: 'center',
    width: '100%',
    ...(Platform.OS === 'android' ? { includeFontPadding: false, textAlignVertical: 'center' } : {}),
  },
  colonSeparatorBox: {
    height: ITEM_HEIGHT,
    width: 16,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  colonSeparatorText: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 2,
    ...(Platform.OS === 'android' ? { includeFontPadding: false } : {}),
  },
  topVignette: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 76,
    zIndex: 4,
  },
  bottomVignette: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 76,
    zIndex: 4,
  },
  nudgeRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
    marginVertical: 10,
  },
  nudgeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    borderWidth: 1,
  },
  nudgeChipText: {
    fontSize: 12,
    fontWeight: '600',
  },
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    height: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 15,
    fontWeight: '600',
  },
  confirmBtn: {
    flex: 2,
    height: 48,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 8,
    elevation: 4,
  },
  confirmBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
