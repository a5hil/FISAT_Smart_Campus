import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { triggerHaptic } from '../utils/haptics';

export default function VerifyEmailScreen() {
  const router = useRouter();
  const [code, setCode] = useState(['', '', '', '']);
  const inputs = useRef<Array<TextInput | null>>([]);

  const handleChange = (text: string, index: number) => {
    if (text) triggerHaptic.selection();
    const newCode = [...code];
    newCode[index] = text;
    setCode(newCode);

    if (text && index < 3) {
      inputs.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (e: any, index: number) => {
    if (e.nativeEvent.key === 'Backspace' && !code[index] && index > 0) {
      triggerHaptic.selection();
      inputs.current[index - 1]?.focus();
    }
  };

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

      <Text style={styles.title}>Verify{'\n'}Your Email</Text>
      <Text style={styles.subtitle}>Please enter the 4 digit code{'\n'}sent to your mail.</Text>

      {/* Code Inputs */}
      <View style={styles.codeContainer}>
        {code.map((digit, index) => (
          <TextInput
            key={index}
            ref={(ref) => { inputs.current[index] = ref; }}
            style={styles.codeInput}
            keyboardType="number-pad"
            maxLength={1}
            value={digit}
            onChangeText={(text) => handleChange(text, index)}
            onKeyPress={(e) => handleKeyPress(e, index)}
          />
        ))}
      </View>

      {/* Resend */}
      <TouchableOpacity 
        style={styles.resendContainer}
        onPress={() => triggerHaptic.light()}
      >
        <Text style={styles.resendText}>Resend code</Text>
      </TouchableOpacity>

      {/* Main Action */}
      <TouchableOpacity 
        style={styles.mainButton} 
        onPress={() => {
          triggerHaptic.medium();
          router.push('/new-password' as any);
        }}
      >
        <Text style={styles.mainButtonText}>Verify</Text>
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
  codeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 32,
  },
  codeInput: {
    width: 70,
    height: 70,
    backgroundColor: '#232323',
    borderRadius: 12,
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
  },
  resendContainer: {
    alignItems: 'center',
    marginBottom: 32,
  },
  resendText: {
    color: '#666666',
    fontSize: 16,
    textDecorationLine: 'underline',
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
