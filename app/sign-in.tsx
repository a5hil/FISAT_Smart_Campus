import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';
import { triggerHaptic } from '../utils/haptics';

export default function SignInScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { loginUser } = useApp();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSignIn = async () => {
    setErrorMessage('');
    const cleanId = identifier.trim();
    const cleanPass = password.trim();

    if (!cleanId) {
      triggerHaptic.warning();
      setErrorMessage('Please enter your username or email address.');
      return;
    }
    if (!cleanPass) {
      triggerHaptic.warning();
      setErrorMessage('Please enter your password.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await loginUser(cleanId, cleanPass);
      if (res.success) {
        triggerHaptic.success();
        router.replace('/(tabs)' as any);
      } else {
        triggerHaptic.error();
        setErrorMessage(res.message || 'Invalid username or password.');
      }
    } catch (err: any) {
      triggerHaptic.error();
      setErrorMessage(err?.message || 'Unable to connect to database. Please check connection.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickFill = (user: string, pass: string) => {
    triggerHaptic.selection();
    setIdentifier(user);
    setPassword(pass);
    setErrorMessage('');
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.container}
    >
      <ScrollView
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: Math.max(60, insets.top + 24),
            paddingBottom: Math.max(40, insets.bottom + 20),
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.badgeText}>FISAT SMART CAMPUS</Text>
          <Text style={styles.title}>Let's{'\n'}Sign you in</Text>
          <Text style={styles.subtitle}>Enter your database credentials to access IoT controllers</Text>
        </View>

        {/* Error Banner */}
        {errorMessage ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color="#EF4444" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Quick Demo Credentials */}
        <View style={styles.demoSection}>
          <Text style={styles.demoTitle}>Quick Demo Accounts (Tap to fill):</Text>
          <View style={styles.demoPillsRow}>
            <TouchableOpacity
              style={styles.demoPill}
              onPress={() => handleQuickFill('admin', 'admin123')}
              activeOpacity={0.7}
            >
              <Ionicons name="shield-checkmark" size={14} color="#F59E0B" />
              <Text style={styles.demoPillText}>Admin</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.demoPill}
              onPress={() => handleQuickFill('faculty', 'faculty123')}
              activeOpacity={0.7}
            >
              <Ionicons name="school" size={14} color="#3B82F6" />
              <Text style={styles.demoPillText}>Faculty</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.demoPill}
              onPress={() => handleQuickFill('student', 'student123')}
              activeOpacity={0.7}
            >
              <Ionicons name="person" size={14} color="#10B981" />
              <Text style={styles.demoPillText}>Student</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Username / Email Input */}
        <View style={styles.inputContainer}>
          <Ionicons name="person-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Username or Email"
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={identifier}
            onChangeText={(t) => {
              setIdentifier(t);
              if (errorMessage) setErrorMessage('');
            }}
          />
        </View>

        {/* Password Input */}
        <View style={styles.inputContainer}>
          <Ionicons name="lock-closed-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
          <TextInput
            style={[styles.input, { paddingRight: 40 }]}
            placeholder="Password"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            value={password}
            onChangeText={(t) => {
              setPassword(t);
              if (errorMessage) setErrorMessage('');
            }}
          />
          <TouchableOpacity
            style={styles.eyeButton}
            onPress={() => {
              triggerHaptic.light();
              setShowPassword(!showPassword);
            }}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* Forgot Password */}
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.forgotPassword}
          onPress={() => {
            triggerHaptic.light();
            router.push('/forget-password' as any);
          }}
        >
          <Text style={styles.forgotPasswordText}>Forgot password?</Text>
        </TouchableOpacity>

        {/* Main Sign In Action Button */}
        <TouchableOpacity
          activeOpacity={0.8}
          style={[styles.mainButton, isLoading && { opacity: 0.7 }]}
          onPress={handleSignIn}
          disabled={isLoading}
        >
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#000000" />
              <Text style={styles.mainButtonText}>Verifying credentials...</Text>
            </View>
          ) : (
            <Text style={styles.mainButtonText}>Sign in</Text>
          )}
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F0F0F',
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingTop: 60,
    paddingBottom: 40,
    flexGrow: 1,
  },
  titleContainer: {
    marginBottom: 28,
  },
  badgeText: {
    color: '#F59E0B',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    marginBottom: 6,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    color: '#FFFFFF',
    lineHeight: 40,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#888888',
    lineHeight: 20,
  },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
    borderColor: '#EF4444',
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    marginBottom: 18,
  },
  errorText: {
    flex: 1,
    color: '#FCA5A5',
    fontSize: 13,
    fontWeight: '500',
  },
  demoSection: {
    marginBottom: 20,
  },
  demoTitle: {
    color: '#777777',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
  },
  demoPillsRow: {
    flexDirection: 'row',
    gap: 8,
  },
  demoPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1E1E1E',
    borderColor: '#333333',
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  demoPillText: {
    color: '#DDDDDD',
    fontSize: 12,
    fontWeight: '600',
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
  eyeButton: {
    padding: 4,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 24,
  },
  forgotPasswordText: {
    color: '#888888',
    fontSize: 14,
  },
  mainButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  mainButtonText: {
    color: '#000000',
    fontSize: 17,
    fontWeight: '600',
  },
});
