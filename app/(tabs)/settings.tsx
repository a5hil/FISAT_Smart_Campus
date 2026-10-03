import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert as RNAlert } from 'react-native';
import { ThemeColors } from '../../constants/colors';
import { Layout } from '../../constants/layout';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useApp } from '../../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Esp32LiveBar } from '../../components/Esp32LiveBar';
import { triggerHaptic } from '../../utils/haptics';

export default function SettingsScreen() {
  const router = useRouter();
  const {
    user,
    campus,
    classrooms,
    esp32Connected,
    esp32Telemetry,
    updateEsp32WiFi,
    logoutUser,
    colors,
    isDark,
    themeMode,
    setThemeMode,
  } = useApp();

  const [wifiModalVisible, setWifiModalVisible] = useState(false);
  const [inputSsid, setInputSsid] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [updatingWifi, setUpdatingWifi] = useState(false);

  const totalDevices = classrooms.reduce((sum, c) => sum + c.devices.length, 0);
  const styles = useMemo(() => getStyles(colors, isDark), [colors, isDark]);

  const handleOpenWifiModal = () => {
    triggerHaptic.light();
    setInputSsid(esp32Telemetry?.ssid || '');
    setInputPassword('');
    setShowPassword(false);
    setWifiModalVisible(true);
  };

  const handleSaveWifi = async () => {
    if (!inputSsid.trim()) {
      triggerHaptic.warning();
      RNAlert.alert('Required', 'Please enter a Wi-Fi network name (SSID).');
      return;
    }
    triggerHaptic.medium();
    setUpdatingWifi(true);
    const res = await updateEsp32WiFi(inputSsid.trim(), inputPassword);
    setUpdatingWifi(false);
    if (res.success) {
      triggerHaptic.success();
      setWifiModalVisible(false);
    } else {
      triggerHaptic.error();
      RNAlert.alert('Could Not Connect', res.message);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Settings & Hardware" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* User Profile Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <Text style={styles.profileName}>{user.name}</Text>
              {user.username ? (
                <View style={[styles.usernameBadge, { backgroundColor: isDark ? 'rgba(245, 158, 11, 0.15)' : 'rgba(217, 119, 6, 0.12)' }]}>
                  <Text style={[styles.usernameBadgeText, { color: colors.primary }]}>@{user.username}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.profileRole}>{user.role}</Text>
            <Text style={styles.profileEmail}>{user.email}</Text>
          </View>
        </View>

        {/* Appearance & Theme Selector */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Appearance & Theme</Text>
          <View style={styles.themeCard}>
            <View style={styles.themeInfoRow}>
              <View style={styles.themeIconBox}>
                <Ionicons name={isDark ? "moon" : "sunny"} size={22} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.themeTitle}>
                  {isDark ? 'Dark Mode' : 'Light Mode'}
                </Text>
                <Text style={styles.themeSubtitle}>
                  {isDark
                    ? 'Deep obsidian black'
                    : 'Clean daylight aesthetic'}
                </Text>
              </View>
            </View>

            {/* Segmented Switch */}
            <View style={styles.themeToggleContainer}>
              <TouchableOpacity
                style={[
                  styles.themeOptionBtn,
                  !isDark && styles.themeOptionBtnActive,
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  triggerHaptic.selection();
                  setThemeMode('light');
                }}
              >
                <Ionicons name="sunny" size={17} color={!isDark ? colors.primary : colors.textMuted} />
                <Text
                  style={[
                    styles.themeOptionText,
                    {
                      color: !isDark ? colors.primary : colors.textSecondary,
                      fontWeight: !isDark ? '700' : '500',
                    },
                  ]}
                >
                  Light Theme
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.themeOptionBtn,
                  isDark && styles.themeOptionBtnActive,
                ]}
                activeOpacity={0.8}
                onPress={() => {
                  triggerHaptic.selection();
                  setThemeMode('dark');
                }}
              >
                <Ionicons name="moon" size={17} color={isDark ? colors.primary : colors.textMuted} />
                <Text
                  style={[
                    styles.themeOptionText,
                    {
                      color: isDark ? colors.primary : colors.textSecondary,
                      fontWeight: isDark ? '700' : '500',
                    },
                  ]}
                >
                  Dark Theme
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* ESP32 Live Controller Management */}
        <Esp32LiveBar />

        {/* Hardware & Network Specs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System & Network</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons name="hardware-chip" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Automation Hub</Text>
              <Text style={styles.infoValue}>Classroom Controller</Text>
            </View>

            {/* Clickable Wi-Fi Network Row to Configure Wi-Fi */}
            <TouchableOpacity
              style={styles.infoRow}
              activeOpacity={0.7}
              onPress={handleOpenWifiModal}
            >
              <Ionicons name="wifi" size={18} color={esp32Connected ? colors.success : colors.textMuted} />
              <Text style={styles.infoLabel}>Wi-Fi Network</Text>
              <View style={styles.wifiValueContainer}>
                <Text style={styles.infoValue}>
                  {esp32Telemetry?.ssid ? `${esp32Telemetry.ssid} (Live)` : (esp32Connected ? 'Connected (Live)' : 'Standby / Offline')}
                </Text>
                <View style={styles.configureBadge}>
                  <Text style={styles.configureBadgeText}>Change</Text>
                </View>
              </View>
            </TouchableOpacity>

            <View style={styles.infoRow}>
              <Ionicons name="globe-outline" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>mDNS URL</Text>
              <Text style={styles.infoValue}>esp32-classroom.local</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="git-branch" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Firmware</Text>
              <Text style={styles.infoValue}>v{esp32Telemetry?.firmware || '2.4.1'}</Text>
            </View>
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Ionicons name="layers" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Controlled Zones</Text>
              <Text style={styles.infoValue}>2 Rooms + Corridors ({totalDevices} dev)</Text>
            </View>
          </View>
        </View>



        {/* Campus Info */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Campus Info</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons name="school" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Institution</Text>
              <Text style={styles.infoValue}>{campus.name}</Text>
            </View>
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Ionicons name="business" size={18} color={colors.primary} />
              <Text style={styles.infoLabel}>Department</Text>
              <Text style={styles.infoValue}>{campus.department}</Text>
            </View>
          </View>
        </View>

        {/* Account Actions / Sign Out */}
        <TouchableOpacity
          style={styles.signOutButton}
          activeOpacity={0.8}
          onPress={() => {
            triggerHaptic.medium();
            RNAlert.alert(
              'Sign Out',
              'Are you sure you want to sign out of this account?',
              [
                { text: 'Cancel', style: 'cancel' },
                {
                  text: 'Sign Out',
                  style: 'destructive',
                  onPress: async () => {
                    triggerHaptic.heavy();
                    await logoutUser();
                    router.replace('/sign-in' as any);
                  },
                },
              ]
            );
          }}
        >
          <Ionicons name="log-out-outline" size={20} color="#EF4444" />
          <Text style={styles.signOutText}>Sign Out of Account</Text>
        </TouchableOpacity>

        <View style={{ height: 100 }} />
      </ScrollView>

      {/* Wi-Fi Configuration Modal */}
      <Modal
        visible={wifiModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => !updatingWifi && setWifiModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalIconBox}>
                <Ionicons name="wifi" size={24} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Configure Controller Wi-Fi</Text>
                <Text style={styles.modalSubtitle}>Update the network your classroom controller connects to</Text>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Wi-Fi Network Name (SSID)</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="wifi-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Campus_WiFi or Hotspot"
                  placeholderTextColor={colors.textMuted}
                  value={inputSsid}
                  onChangeText={setInputSsid}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Wi-Fi Password</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.textInput, { paddingRight: 40 }]}
                  placeholder="Leave empty if open network"
                  placeholderTextColor={colors.textMuted}
                  value={inputPassword}
                  onChangeText={setInputPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity
                  style={styles.eyeBtn}
                  onPress={() => {
                    triggerHaptic.selection();
                    setShowPassword(!showPassword);
                  }}
                >
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.noteBox}>
              <Ionicons name="information-circle-outline" size={16} color={colors.primary} />
              <Text style={styles.noteText}>
                The controller will save these credentials to permanent NVS flash memory and reboot into the new network.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => {
                  triggerHaptic.light();
                  setWifiModalVisible(false);
                }}
                disabled={updatingWifi}
              >
                <Text style={styles.cancelBtnText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.saveBtn, updatingWifi && { opacity: 0.7 }]}
                onPress={handleSaveWifi}
                disabled={updatingWifi}
              >
                {updatingWifi ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#FFFFFF" />
                    <Text style={styles.saveBtnText}>Update & Reboot</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const getStyles = (colors: ThemeColors, isDark: boolean) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scrollContent: {
      padding: Layout.spacing.md,
    },
    profileCard: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 20,
      gap: 16,
    },
    avatar: {
      width: 50,
      height: 50,
      borderRadius: 25,
      backgroundColor: colors.primary,
      justifyContent: 'center',
      alignItems: 'center',
    },
    avatarText: {
      color: '#FFFFFF',
      fontSize: 18,
      fontWeight: '700',
    },
    profileInfo: {
      flex: 1,
    },
    profileName: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    usernameBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: 10,
    },
    usernameBadgeText: {
      fontSize: 11,
      fontWeight: '700',
    },
    profileRole: {
      color: colors.primary,
      fontSize: 13,
      marginTop: 2,
      fontWeight: '600',
    },
    profileEmail: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    signOutButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: isDark ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.08)',
      borderColor: 'rgba(239, 68, 68, 0.3)',
      borderWidth: 1,
      borderRadius: Layout.radius.lg,
      paddingVertical: 14,
      marginTop: 4,
      marginBottom: 20,
    },
    signOutText: {
      color: '#EF4444',
      fontSize: 15,
      fontWeight: '600',
    },
    section: {
      marginBottom: 20,
    },
    sectionTitle: {
      color: colors.text,
      fontSize: 15,
      fontWeight: '700',
      marginBottom: 10,
    },
    themeCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      padding: 16,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    themeInfoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      marginBottom: 14,
    },
    themeIconBox: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primarySubtle,
      justifyContent: 'center',
      alignItems: 'center',
    },
    themeTitle: {
      color: colors.text,
      fontSize: 16,
      fontWeight: '700',
    },
    themeSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
      lineHeight: 16,
    },
    themeToggleContainer: {
      flexDirection: 'row',
      backgroundColor: colors.cardSecondary,
      borderRadius: Layout.radius.md,
      padding: 4,
      gap: 6,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    themeOptionBtn: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 10,
      borderRadius: Layout.radius.sm,
      gap: 8,
    },
    themeOptionBtnActive: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.primary,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: isDark ? 0.3 : 0.08,
      shadowRadius: 3,
      elevation: 2,
    },
    themeOptionText: {
      fontSize: 13,
    },
    infoCard: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.lg,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      overflow: 'hidden',
    },
    infoRow: {
      flexDirection: 'row',
      alignItems: 'center',
      padding: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.surfaceBorder,
      gap: 12,
    },
    infoLabel: {
      color: colors.textSecondary,
      fontSize: 13,
      flex: 1,
    },
    infoValue: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
    },
    wifiValueContainer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    configureBadge: {
      backgroundColor: colors.primarySubtle,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.primarySubtle,
    },
    configureBadgeText: {
      color: colors.primary,
      fontSize: 11,
      fontWeight: '700',
    },

    modalOverlay: {
      flex: 1,
      backgroundColor: colors.modalOverlay,
      justifyContent: 'center',
      alignItems: 'center',
      padding: 20,
    },
    modalContent: {
      backgroundColor: colors.card,
      borderRadius: Layout.radius.xl,
      padding: 24,
      width: '100%',
      maxWidth: 400,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    modalHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      marginBottom: 20,
    },
    modalIconBox: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: colors.primarySubtle,
      justifyContent: 'center',
      alignItems: 'center',
    },
    modalTitle: {
      color: colors.text,
      fontSize: 17,
      fontWeight: '700',
    },
    modalSubtitle: {
      color: colors.textSecondary,
      fontSize: 12,
      marginTop: 2,
    },
    inputGroup: {
      marginBottom: 16,
    },
    inputLabel: {
      color: colors.text,
      fontSize: 13,
      fontWeight: '600',
      marginBottom: 6,
    },
    inputWrapper: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.inputBackground,
      borderRadius: Layout.radius.md,
      borderWidth: 1,
      borderColor: colors.inputBorder,
      paddingHorizontal: 12,
    },
    inputIcon: {
      marginRight: 8,
    },
    textInput: {
      flex: 1,
      color: colors.text,
      fontSize: 14,
      paddingVertical: 12,
    },
    eyeBtn: {
      padding: 6,
    },
    noteBox: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      backgroundColor: colors.primarySubtle,
      borderRadius: Layout.radius.md,
      padding: 12,
      gap: 10,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: colors.primarySubtle,
    },
    noteText: {
      color: colors.textSecondary,
      fontSize: 12,
      lineHeight: 16,
      flex: 1,
    },
    modalActions: {
      flexDirection: 'row',
      gap: 12,
    },
    cancelBtn: {
      flex: 1,
      paddingVertical: 13,
      borderRadius: Layout.radius.md,
      backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.05)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    cancelBtnText: {
      color: colors.text,
      fontSize: 14,
      fontWeight: '600',
    },
    saveBtn: {
      flex: 2,
      paddingVertical: 13,
      borderRadius: Layout.radius.md,
      backgroundColor: colors.primary,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    saveBtnText: {
      color: '#FFFFFF',
      fontSize: 14,
      fontWeight: '700',
    },
  });
