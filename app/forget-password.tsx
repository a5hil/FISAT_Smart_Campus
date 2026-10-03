import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { triggerHaptic } from '../utils/haptics';

export default function ForgetPasswordScreen() {
  const router = useRouter();

  return (
    <View style={styles.container}>
      {/* Header */}
      <TouchableOpacity 
        style={styles.backButton} 
        onPress={() => {
          triggerHaptic.light();
          router.back();
        }}
      >
        <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
        <Text style={styles.backText}>Back</Text>
      </TouchableOpacity>

      <Text style={styles.title}>Forget{'\n'}Password?</Text>
      <Text style={styles.subtitle}>Enter your email address</Text>

      {/* Input */}
      <View style={styles.inputContainer}>
        <Ionicons name="mail-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
        <TextInput 
          style={styles.input}
          placeholder="Email id"
          placeholderTextColor={Colors.textMuted}
          keyboardType="email-address"
          autoCapitalize="none"
        />
      </View>

      {/* Main Action */}
      <TouchableOpacity 
        style={styles.mainButton} 
        onPress={() => {
          triggerHaptic.medium();
          router.push('/verify-email' as any);
        }}
      >
        <Text style={styles.mainButtonText}>Send</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F0F',
    paddingHorizontal: 24,
    paddingTop: 60,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 40,
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginLeft: 4,
  },
  title: {
    fontSize: 36,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 44,
    marginBottom: 40,
  },
  subtitle: {
    color: '#666666',
    fontSize: 16,
    marginBottom: 16,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#232323',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 40,
    height: 56,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: 16,
  },
  mainButton: {
    backgroundColor: '#D9D9D9',
    borderRadius: 12,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mainButtonText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: '500',
  },
});
