import React from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { triggerHaptic } from '../utils/haptics';

export default function NewPasswordScreen() {
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

      <Text style={styles.title}>Create{'\n'}New Password</Text>
      <Text style={styles.subtitle}>Your new password must be different{'\n'}from previously use password</Text>

      {/* Inputs */}
      <View style={styles.inputContainer}>
        <Ionicons name="lock-closed-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
        <TextInput 
          style={styles.input}
          placeholder="New Password"
          placeholderTextColor={Colors.textMuted}
          secureTextEntry
        />
      </View>

      <View style={styles.inputContainer}>
        <Ionicons name="lock-closed-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
        <TextInput 
          style={styles.input}
          placeholder="Confirm Password"
          placeholderTextColor={Colors.textMuted}
          secureTextEntry
        />
      </View>

      {/* Main Action */}
      <TouchableOpacity 
        style={styles.mainButton} 
        onPress={() => {
          triggerHaptic.success();
          router.push('/sign-in' as any);
        }}
      >
        <Text style={styles.mainButtonText}>Save</Text>
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
    marginBottom: 16,
  },
  subtitle: {
    color: '#666666',
    fontSize: 16,
    lineHeight: 24,
    marginBottom: 40,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#232323',
    borderRadius: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
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
    marginTop: 24,
  },
  mainButtonText: {
    color: '#000000',
    fontSize: 18,
    fontWeight: '500',
  },
});
