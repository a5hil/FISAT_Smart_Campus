import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, TextInput, ActivityIndicator, Alert as RNAlert } from 'react-native';
import { Colors } from '../../constants/colors';
import { Layout } from '../../constants/layout';
import { ScreenHeader } from '../../components/ScreenHeader';
import { useApp } from '../../context/AppContext';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Esp32LiveBar } from '../../components/Esp32LiveBar';

export default function SettingsScreen() {
  const router = useRouter();
  const { user, campus, classrooms, esp32Connected, esp32Telemetry, updateEsp32WiFi, timetable } = useApp();

  const [wifiModalVisible, setWifiModalVisible] = useState(false);
  const [inputSsid, setInputSsid] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [updatingWifi, setUpdatingWifi] = useState(false);

  const totalDevices = classrooms.reduce((sum, c) => sum + c.devices.length, 0);

  const handleOpenWifiModal = () => {
    setInputSsid(esp32Telemetry?.ssid || '');
    setInputPassword('');
    setShowPassword(false);
    setWifiModalVisible(true);
  };

  const handleSaveWifi = async () => {
    if (!inputSsid.trim()) {
      RNAlert.alert('Required', 'Please enter a Wi-Fi network name (SSID).');
      return;
    }
    setUpdatingWifi(true);
    const res = await updateEsp32WiFi(inputSsid.trim(), inputPassword);
    setUpdatingWifi(false);
    if (res.success) {
      setWifiModalVisible(false);
    } else {
      RNAlert.alert('Could Not Connect', res.message);
    }
  };

  return (
    <View style={styles.container}>
      <ScreenHeader title="Settings & Hardware" />

      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        {/* User Card */}
        <View style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.initials}</Text>
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileName}>{user.name}</Text>
            <Text style={styles.profileRole}>{user.role}</Text>
            <Text style={styles.profileEmail}>{user.email}</Text>
          </View>
        </View>

        {/* ESP32 Live Controller Management */}
        <Esp32LiveBar />

        {/* Timetable & Period Bell Automation */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Classroom Timetable & Period Bell</Text>
          <TouchableOpacity 
            style={styles.timetableCard}
            activeOpacity={0.8}
            onPress={() => router.push('/timetable')}
          >
            <View style={styles.timetableIconBox}>
              <Ionicons name="notifications" size={24} color={Colors.primary} />
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
            <Ionicons name="chevron-forward" size={20} color={Colors.textMuted} />
          </TouchableOpacity>
        </View>

        {/* Hardware & Network Specs */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>System & Network</Text>
          <View style={styles.infoCard}>
            <View style={styles.infoRow}>
              <Ionicons name="hardware-chip" size={18} color={Colors.primary} />
              <Text style={styles.infoLabel}>Automation Hub</Text>
              <Text style={styles.infoValue}>Classroom Controller</Text>
            </View>

            {/* Clickable Wi-Fi Network Row to Configure Wi-Fi */}
            <TouchableOpacity 
              style={styles.infoRow}
              activeOpacity={0.7}
              onPress={handleOpenWifiModal}
            >
              <Ionicons name="wifi" size={18} color={esp32Connected ? Colors.success : Colors.textMuted} />
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
              <Ionicons name="globe-outline" size={18} color={Colors.primary} />
              <Text style={styles.infoLabel}>mDNS URL</Text>
              <Text style={styles.infoValue}>esp32-classroom.local</Text>
            </View>
            <View style={styles.infoRow}>
              <Ionicons name="git-branch" size={18} color={Colors.primary} />
              <Text style={styles.infoLabel}>Firmware</Text>
              <Text style={styles.infoValue}>v{esp32Telemetry?.firmware || '2.4.1'}</Text>
            </View>
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Ionicons name="layers" size={18} color={Colors.primary} />
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
              <Ionicons name="school" size={18} color={Colors.primary} />
              <Text style={styles.infoLabel}>Institution</Text>
              <Text style={styles.infoValue}>{campus.name}</Text>
            </View>
            <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
              <Ionicons name="business" size={18} color={Colors.primary} />
              <Text style={styles.infoLabel}>Department</Text>
              <Text style={styles.infoValue}>{campus.department}</Text>
            </View>
          </View>
        </View>

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
                <Ionicons name="wifi" size={24} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Configure Controller Wi-Fi</Text>
                <Text style={styles.modalSubtitle}>Update the network your classroom controller connects to</Text>
              </View>
            </View>

            <View style={styles.inputGroup}>
              <Text style={styles.inputLabel}>Wi-Fi Network Name (SSID)</Text>
              <View style={styles.inputWrapper}>
                <Ionicons name="wifi-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={styles.textInput}
                  placeholder="e.g. Campus_WiFi or Hotspot"
                  placeholderTextColor={Colors.textMuted}
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
                <Ionicons name="lock-closed-outline" size={18} color={Colors.textMuted} style={styles.inputIcon} />
                <TextInput
                  style={[styles.textInput, { paddingRight: 40 }]}
                  placeholder="Leave empty if open network"
                  placeholderTextColor={Colors.textMuted}
                  value={inputPassword}
                  onChangeText={setInputPassword}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <TouchableOpacity 
                  style={styles.eyeBtn}
                  onPress={() => setShowPassword(!showPassword)}
                >
                  <Ionicons name={showPassword ? "eye-off-outline" : "eye-outline"} size={18} color={Colors.textMuted} />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.noteBox}>
              <Ionicons name="information-circle-outline" size={16} color={Colors.primary} />
              <Text style={styles.noteText}>
                The controller will save these credentials to permanent NVS flash memory and reboot into the new network.
              </Text>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={() => setWifiModalVisible(false)}
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
                  <ActivityIndicator size="small" color="#000" />
                ) : (
                  <>
                    <Ionicons name="checkmark-circle-outline" size={18} color="#000" />
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: Layout.spacing.md,
  },
  profileCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
    marginBottom: 20,
    gap: 16,
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#000',
    fontSize: 18,
    fontWeight: '700',
  },
  profileInfo: {
    flex: 1,
  },
  profileName: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '700',
  },
  profileRole: {
    color: Colors.primary,
    fontSize: 13,
    marginTop: 2,
  },
  profileEmail: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 10,
  },
  infoCard: {
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
    overflow: 'hidden',
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.surfaceTranslucent,
    gap: 12,
  },
  infoLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    flex: 1,
  },
  infoValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  wifiValueContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  configureBadge: {
    backgroundColor: 'rgba(253, 168, 58, 0.15)',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(253, 168, 58, 0.3)',
  },
  configureBadgeText: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '700',
  },
  // Modal Styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.xl,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
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
    backgroundColor: 'rgba(253, 168, 58, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  modalSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  inputGroup: {
    marginBottom: 16,
  },
  inputLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1E1E1E',
    borderRadius: Layout.radius.md,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
    paddingHorizontal: 12,
  },
  inputIcon: {
    marginRight: 8,
  },
  textInput: {
    flex: 1,
    color: Colors.text,
    fontSize: 14,
    paddingVertical: 12,
  },
  eyeBtn: {
    padding: 6,
  },
  noteBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: 'rgba(253, 168, 58, 0.08)',
    borderRadius: Layout.radius.md,
    padding: 12,
    gap: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(253, 168, 58, 0.2)',
  },
  noteText: {
    color: Colors.textMuted,
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
    backgroundColor: 'rgba(255, 255, 255, 0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  saveBtn: {
    flex: 2,
    paddingVertical: 13,
    borderRadius: Layout.radius.md,
    backgroundColor: Colors.primary,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  saveBtnText: {
    color: '#000',
    fontSize: 14,
    fontWeight: '700',
  },
  timetableCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderRadius: Layout.radius.lg,
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(253, 168, 58, 0.25)',
    gap: 14,
  },
  timetableIconBox: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(253, 168, 58, 0.12)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(253, 168, 58, 0.2)',
  },
  timetableCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timetableCardTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '700',
  },
  timetableCardSubtitle: {
    color: Colors.textMuted,
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
    backgroundColor: 'rgba(46, 213, 115, 0.15)',
    borderColor: 'rgba(46, 213, 115, 0.3)',
  },
  badgeDisabled: {
    backgroundColor: 'rgba(150, 150, 150, 0.15)',
    borderColor: 'rgba(150, 150, 150, 0.3)',
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
  },
  badgeTextActive: {
    color: Colors.success,
  },
  badgeTextDisabled: {
    color: Colors.textMuted,
  },
});
