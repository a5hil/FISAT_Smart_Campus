import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  TouchableWithoutFeedback,
  ScrollView,
  Platform,
  ActivityIndicator,
  Keyboard,
  Dimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { NoticeDuration } from '../types';
import { useApp, useTheme } from '../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { triggerHaptic } from '../utils/haptics';

interface NoticeModalProps {
  visible: boolean;
  onClose: () => void;
  defaultClassroomId?: string; // 'all' or 'cls-a101', etc.
  defaultClassroomName?: string;
}

export function NoticeModal({
  visible,
  onClose,
  defaultClassroomId = 'all',
  defaultClassroomName,
}: NoticeModalProps) {
  const { addNotice, classrooms } = useApp();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();

  const [targetId, setTargetId] = useState<string>(defaultClassroomId);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [duration, setDuration] = useState<NoticeDuration>('24h');
  const [submitting, setSubmitting] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  const styles = React.useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  useEffect(() => {
    const showSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const hideSub = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardHeight(0);
      }
    );
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    if (visible) {
      // Disallow preselecting a corridor or hallway
      const isCorridorTarget = Boolean(
        defaultClassroomId &&
        (defaultClassroomId.toLowerCase().includes('corridor') ||
         defaultClassroomId.toLowerCase().includes('hallway'))
      );
      setTargetId(isCorridorTarget ? 'all' : defaultClassroomId);
      setTitle('');
      setMessage('');
      setDuration('24h');
      setSubmitting(false);
    }
  }, [visible, defaultClassroomId]);

  // Real classrooms only - explicitly exclude corridors, hallways, and non-classroom areas
  const targetOptions = [
    { id: 'all', label: 'All Classrooms (Broadcast)' },
    ...classrooms
      .filter((c) => {
        const id = c.id.toLowerCase();
        const name = c.name.toLowerCase();
        return !id.includes('corridor') && !id.includes('hallway') &&
               !name.includes('corridor') && !name.includes('hallway') &&
               c.capacity > 0;
      })
      .map((c) => ({ id: c.id, label: c.name })),
  ];

  const isFormValid = title.trim().length > 0 && message.trim().length > 0;

  const handlePublish = async () => {
    if (!isFormValid || submitting) return;

    setSubmitting(true);
    try {
      const selectedClassroom = classrooms.find((c) => c.id === targetId);
      const classroomName =
        targetId === 'all'
          ? 'All Classrooms'
          : selectedClassroom?.name || defaultClassroomName || 'Classroom';

      await addNotice({
        title: title.trim(),
        message: message.trim(),
        classroomId: targetId,
        classroomName,
        duration,
        postedBy: 'Admin',
      });

      triggerHaptic.success();
      onClose();
    } catch {
      triggerHaptic.error();
    } finally {
      setSubmitting(false);
    }
  };

  const windowHeight = Dimensions.get('window').height;
  const dynamicMaxHeight = keyboardHeight > 0
    ? Math.max(260, windowHeight - insets.top - keyboardHeight - 16)
    : (Platform.OS === 'android' ? '92%' : '88%');

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.modalOverlay}>
        <TouchableWithoutFeedback onPress={onClose}>
          <View style={StyleSheet.absoluteFill} />
        </TouchableWithoutFeedback>

        <View
          style={[
            styles.modalContainer,
            {
              marginBottom: keyboardHeight > 0 ? keyboardHeight : 0,
              paddingBottom: keyboardHeight > 0 ? 12 : Math.max(insets.bottom + 16, 28),
              maxHeight: dynamicMaxHeight,
            },
          ]}
        >
          {/* Header */}
          <View style={styles.modalHeader}>
            <View style={styles.headerTitleRow}>
              <View style={styles.headerIconBox}>
                <Ionicons name="megaphone" size={20} color={colors.primary} />
              </View>
              <View>
                <Text style={styles.modalTitle}>Post Announcement</Text>
                <Text style={styles.modalSubtitle}>Classroom Digital Board</Text>
              </View>
            </View>
            <TouchableOpacity style={styles.closeButton} onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Ionicons name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            style={{ flexShrink: 1 }}
          >
            {/* Target Classroom Selection */}
            <Text style={styles.inputLabel}>Target Classroom / Scope</Text>
            <View style={styles.targetPillGroup}>
              {targetOptions.map((opt) => {
                const isSelected = targetId === opt.id;
                return (
                  <TouchableOpacity
                    key={opt.id}
                    style={[styles.targetPill, isSelected && styles.targetPillActive]}
                    onPress={() => {
                      triggerHaptic.selection();
                      setTargetId(opt.id);
                    }}
                  >
                    <Ionicons
                      name={opt.id === 'all' ? 'megaphone' : 'business'}
                      size={14}
                      color={isSelected ? (isDark ? '#000000' : '#FFFFFF') : colors.textSecondary}
                    />
                    <Text style={[styles.targetPillText, isSelected && styles.targetPillTextActive]}>
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Notice Title Input */}
            <View style={styles.labelRow}>
              <Text style={styles.inputLabel}>Notice Title</Text>
              <Text style={styles.charCount}>{title.length}/30</Text>
            </View>
            <TextInput
              style={styles.textInput}
              placeholder="e.g., Staff Meeting, Quiz Postponed..."
              placeholderTextColor={colors.inputPlaceholder}
              value={title}
              onChangeText={(t) => setTitle(t.slice(0, 30))}
              maxLength={30}
            />

            {/* Notice Message Input */}
            <View style={styles.labelRow}>
              <Text style={styles.inputLabel}>Announcement Message</Text>
              <Text style={styles.charCount}>{message.length}/140</Text>
            </View>
            <TextInput
              style={[styles.textInput, styles.multilineInput]}
              placeholder="Type message to display on the classroom notice board..."
              placeholderTextColor={colors.inputPlaceholder}
              value={message}
              onChangeText={(m) => setMessage(m.slice(0, 140))}
              maxLength={140}
              multiline
              numberOfLines={3}
              textAlignVertical="top"
            />

            {/* Expiration Duration Selector */}
            <Text style={styles.inputLabel}>Display Duration</Text>
            <View style={styles.durationRow}>
              <TouchableOpacity
                style={[styles.durationPill, duration === '1h' && styles.durationPillActive]}
                onPress={() => {
                  triggerHaptic.selection();
                  setDuration('1h');
                }}
              >
                <Ionicons
                  name="time-outline"
                  size={16}
                  color={duration === '1h' ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.durationPillTitle, duration === '1h' && styles.durationPillTitleActive]}>
                  1 Hour
                </Text>
                <Text style={styles.durationPillSub}>Auto-expires</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.durationPill, duration === '24h' && styles.durationPillActive]}
                onPress={() => {
                  triggerHaptic.selection();
                  setDuration('24h');
                }}
              >
                <Ionicons
                  name="calendar-outline"
                  size={16}
                  color={duration === '24h' ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.durationPillTitle, duration === '24h' && styles.durationPillTitleActive]}>
                  1 Day (24h)
                </Text>
                <Text style={styles.durationPillSub}>Daily notice</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.durationPill, duration === 'never' && styles.durationPillActive]}
                onPress={() => {
                  triggerHaptic.selection();
                  setDuration('never');
                }}
              >
                <Ionicons
                  name="pin-outline"
                  size={16}
                  color={duration === 'never' ? colors.primary : colors.textMuted}
                />
                <Text style={[styles.durationPillTitle, duration === 'never' && styles.durationPillTitleActive]}>
                  Until Deleted
                </Text>
                <Text style={styles.durationPillSub}>Persistent</Text>
              </TouchableOpacity>
            </View>
          </ScrollView>

          {/* Action Buttons */}
          <View style={styles.modalFooter}>
            <TouchableOpacity 
              style={styles.cancelButton} 
              onPress={() => {
                triggerHaptic.light();
                onClose();
              }} 
              disabled={submitting}
            >
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.publishButton, (!isFormValid || submitting) && styles.publishButtonDisabled]}
              onPress={handlePublish}
              disabled={!isFormValid || submitting}
            >
              {submitting ? (
                <ActivityIndicator size="small" color={isDark ? '#000000' : '#FFFFFF'} />
              ) : (
                <>
                  <Ionicons name="send" size={16} color={isDark ? '#000000' : '#FFFFFF'} style={{ marginRight: 6 }} />
                  <Text style={styles.publishButtonText}>Publish Announcement</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function getStyles(colors: any, isDark: boolean) {
  return StyleSheet.create({
    modalOverlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'flex-end',
    },
    modalContainer: {
      backgroundColor: colors.card,
      borderTopLeftRadius: 24,
      borderTopRightRadius: 24,
      width: '100%',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
    },
    headerTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    headerIconBox: {
      width: 38,
      height: 38,
      borderRadius: 12,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.15)' : 'rgba(217, 119, 6, 0.12)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    modalTitle: {
      color: colors.text,
      fontSize: 18,
      fontWeight: '700',
    },
    modalSubtitle: {
      color: colors.textMuted,
      fontSize: 12,
    },
    closeButton: {
      padding: 6,
      borderRadius: 16,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : colors.cardSecondary,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 16,
      paddingBottom: 12,
    },
    inputLabel: {
      color: colors.textSecondary,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 8,
    },
    labelRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    charCount: {
      color: colors.textMuted,
      fontSize: 11,
    },
    targetPillGroup: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginBottom: 16,
    },
    targetPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : colors.cardSecondary,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    targetPillActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    targetPillText: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    targetPillTextActive: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontWeight: '700',
    },
    textInput: {
      backgroundColor: colors.inputBackground,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      borderRadius: 12,
      paddingHorizontal: 14,
      paddingVertical: 12,
      color: colors.text,
      fontSize: 14,
      marginBottom: 16,
    },
    multilineInput: {
      height: 80,
      paddingTop: 12,
    },
    durationRow: {
      flexDirection: 'row',
      gap: 10,
      marginBottom: 12,
    },
    durationPill: {
      flex: 1,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.04)' : colors.cardSecondary,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: 12,
      paddingVertical: 10,
      paddingHorizontal: 8,
      alignItems: 'center',
      gap: 4,
    },
    durationPillActive: {
      borderColor: colors.primary,
      backgroundColor: isDark ? 'rgba(253, 168, 58, 0.12)' : 'rgba(217, 119, 6, 0.1)',
    },
    durationPillTitle: {
      color: colors.textSecondary,
      fontSize: 12,
      fontWeight: '600',
    },
    durationPillTitleActive: {
      color: colors.primary,
      fontWeight: '700',
    },
    durationPillSub: {
      color: colors.textMuted,
      fontSize: 10,
    },
    modalFooter: {
      flexDirection: 'row',
      gap: 12,
      paddingHorizontal: 20,
      paddingTop: 14,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    cancelButton: {
      flex: 1,
      paddingVertical: 14,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.06)' : colors.cardSecondary,
    },
    cancelButtonText: {
      color: colors.textSecondary,
      fontSize: 14,
      fontWeight: '600',
    },
    publishButton: {
      flex: 2,
      flexDirection: 'row',
      paddingVertical: 14,
      borderRadius: 14,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primary,
    },
    publishButtonDisabled: {
      opacity: 0.45,
    },
    publishButtonText: {
      color: isDark ? '#000000' : '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
  });
}
