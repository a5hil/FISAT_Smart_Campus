import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert as RNAlert } from 'react-native';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { Ionicons } from '@expo/vector-icons';
import { useApp } from '../context/AppContext';

export function QuickControls() {
  const { 
    quickControls, 
    toggleQuickControl, 
    emergencyOff, 
    systemMode, 
    toggleEsp32Mode,
    colors,
    isDark,
  } = useApp();

  const handleEmergencyOff = () => {
    RNAlert.alert(
      "Emergency Off",
      "Are you sure you want to turn off all devices and close curtains across both classrooms?",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Turn Off All", style: "destructive", onPress: emergencyOff }
      ]
    );
  };

  const isAuto = systemMode === 'auto';
  const activeBtnTextColor = isDark ? '#000000' : '#FFFFFF';

  return (
    <View style={styles.container}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Quick Hardware Controls</Text>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Auto / Manual Mode Toggle */}
        <TouchableOpacity 
          style={[
            styles.controlButton,
            {
              backgroundColor: isAuto ? colors.successSubtle : colors.primarySubtle,
              borderColor: isAuto ? colors.success : colors.primary,
            }
          ]}
          onPress={toggleEsp32Mode}
        >
          <Ionicons 
            name={isAuto ? "sparkles" : "hand-left"} 
            size={18} 
            color={isAuto ? colors.success : colors.primary} 
          />
          <Text style={[styles.controlText, { color: isAuto ? colors.success : colors.primary, fontWeight: '700' }]}>
            {isAuto ? 'Auto Mode' : 'Manual Mode'}
          </Text>
        </TouchableOpacity>

        {/* All Lights */}
        <TouchableOpacity 
          style={[
            styles.controlButton,
            {
              backgroundColor: quickControls.allLights ? colors.primary : colors.card,
              borderColor: quickControls.allLights ? colors.primary : colors.surfaceBorder,
            }
          ]}
          onPress={() => toggleQuickControl('allLights')}
        >
          <Ionicons 
            name={quickControls.allLights ? "bulb" : "bulb-outline"} 
            size={18} 
            color={quickControls.allLights ? activeBtnTextColor : colors.text} 
          />
          <Text style={[styles.controlText, { color: quickControls.allLights ? activeBtnTextColor : colors.text }]}>
            All Lights
          </Text>
        </TouchableOpacity>

        {/* All Fans */}
        <TouchableOpacity 
          style={[
            styles.controlButton,
            {
              backgroundColor: quickControls.allFans ? colors.primary : colors.card,
              borderColor: quickControls.allFans ? colors.primary : colors.surfaceBorder,
            }
          ]}
          onPress={() => toggleQuickControl('allFans')}
        >
          <Ionicons 
            name="hardware-chip-outline" 
            size={18} 
            color={quickControls.allFans ? activeBtnTextColor : colors.text} 
          />
          <Text style={[styles.controlText, { color: quickControls.allFans ? activeBtnTextColor : colors.text }]}>
            All Fans
          </Text>
        </TouchableOpacity>

        {/* All Curtains */}
        <TouchableOpacity 
          style={[
            styles.controlButton,
            {
              backgroundColor: quickControls.allCurtains ? colors.primary : colors.card,
              borderColor: quickControls.allCurtains ? colors.primary : colors.surfaceBorder,
            }
          ]}
          onPress={() => toggleQuickControl('allCurtains')}
        >
          <Ionicons 
            name="apps-outline" 
            size={18} 
            color={quickControls.allCurtains ? activeBtnTextColor : colors.text} 
          />
          <Text style={[styles.controlText, { color: quickControls.allCurtains ? activeBtnTextColor : colors.text }]}>
            All Curtains
          </Text>
        </TouchableOpacity>

        {/* Emergency All Off */}
        <TouchableOpacity 
          style={[
            styles.controlButton,
            {
              backgroundColor: colors.criticalSubtle,
              borderColor: colors.critical,
            }
          ]}
          onPress={handleEmergencyOff}
        >
          <Ionicons name="power" size={18} color={colors.critical} />
          <Text style={[styles.controlText, { color: colors.critical, fontWeight: '700' }]}>Emergency Off</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
    paddingHorizontal: Layout.spacing.md,
  },
  scrollContent: {
    paddingHorizontal: Layout.spacing.md,
    gap: 12,
  },
  controlButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: Layout.radius.round,
    borderWidth: 1,
    borderColor: Colors.surfaceTranslucent,
    gap: 8,
  },
  controlButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  modeButtonAuto: {
    backgroundColor: 'rgba(34, 197, 94, 0.1)',
    borderColor: 'rgba(34, 197, 94, 0.3)',
  },
  modeButtonManual: {
    backgroundColor: 'rgba(253, 168, 58, 0.1)',
    borderColor: 'rgba(253, 168, 58, 0.3)',
  },
  controlText: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  controlTextActive: {
    color: '#000',
  },
  emergencyButton: {
    borderColor: 'rgba(255, 98, 95, 0.3)',
    backgroundColor: 'rgba(255, 98, 95, 0.1)',
  },
});
