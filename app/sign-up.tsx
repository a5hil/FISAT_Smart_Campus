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
  Alert as RNAlert,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../constants/colors';
import { Layout } from '../constants/layout';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useApp } from '../context/AppContext';

export default function SignUpScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { registerUser, showToast } = useApp();

  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleSignUp = async () => {
    setErrorMessage('');

    if (!fullName.trim()) {
      setErrorMessage('Please enter your full name.');
      return;
    }
    if (!username.trim()) {
      setErrorMessage('Please choose a username.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setErrorMessage('Please enter a valid email address.');
      return;
    }
    if (!password.trim() || password.length < 4) {
      setErrorMessage('Password must be at least 4 characters long.');
      return;
    }
    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      const res = await registerUser(
        fullName.trim(),
        username.trim(),
        email.trim(),
        password.trim(),
        'Faculty / Student',
        'IMCA Department'
      );

      if (res.success) {
        showToast('Account created! Please sign in.', 'success');
        RNAlert.alert('Registration Successful', 'Your account has been added to the database. You can now log in.', [
          { text: 'Go to Sign In', onPress: () => router.replace('/sign-in' as any) },
        ]);
      } else {
        setErrorMessage(res.message || 'Registration failed.');
      }
    } catch (err: any) {
      setErrorMessage(err?.message || 'Failed to register account.');
    } finally {
      setIsLoading(false);
    }
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
            paddingTop: Math.max(50, insets.top + 16),
            paddingBottom: Math.max(40, insets.bottom + 20),
          },
        ]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
          activeOpacity={0.7}
        >
          <Ionicons name="chevron-back" size={20} color="#FFFFFF" />
          <Text style={styles.backText}>Back</Text>
        </TouchableOpacity>

        {/* Title */}
        <View style={styles.titleContainer}>
          <Text style={styles.badgeText}>NEW USER REGISTRATION</Text>
          <Text style={styles.title}>Let's{'\n'}Get Started</Text>
          <Text style={styles.subtitle}>Create your profile in the FISAT Smart Classroom database</Text>
        </View>

        {/* Error Banner */}
        {errorMessage ? (
          <View style={styles.errorBox}>
            <Ionicons name="alert-circle" size={18} color="#EF4444" />
            <Text style={styles.errorText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Full Name */}
        <View style={styles.inputContainer}>
          <Ionicons name="person-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Full Name (e.g. John Doe)"
            placeholderTextColor={Colors.textMuted}
            value={fullName}
            onChangeText={(t) => {
              setFullName(t);
              if (errorMessage) setErrorMessage('');
            }}
          />
        </View>

        {/* Username */}
        <View style={styles.inputContainer}>
          <Ionicons name="at-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Username (e.g. jdoe24)"
            placeholderTextColor={Colors.textMuted}
            autoCapitalize="none"
            autoCorrect={false}
            value={username}
            onChangeText={(t) => {
              setUsername(t);
              if (errorMessage) setErrorMessage('');
            }}
          />
        </View>

        {/* Email */}
        <View style={styles.inputContainer}>
          <Ionicons name="mail-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Email Address"
            placeholderTextColor={Colors.textMuted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            value={email}
            onChangeText={(t) => {
              setEmail(t);
              if (errorMessage) setErrorMessage('');
            }}
          />
        </View>

        {/* Password */}
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
            onPress={() => setShowPassword(!showPassword)}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={Colors.textMuted}
            />
          </TouchableOpacity>
        </View>

        {/* Confirm Password */}
        <View style={styles.inputContainer}>
          <Ionicons name="shield-checkmark-outline" size={20} color={Colors.textMuted} style={styles.inputIcon} />
          <TextInput
            style={styles.input}
            placeholder="Confirm Password"
            placeholderTextColor={Colors.textMuted}
            secureTextEntry={!showPassword}
            autoCapitalize="none"
            autoCorrect={false}
            value={confirmPassword}
            onChangeText={(t) => {
              setConfirmPassword(t);
              if (errorMessage) setErrorMessage('');
            }}
          />
        </View>

        {/* Register Button */}
        <TouchableOpacity
          style={[styles.mainButton, isLoading && { opacity: 0.7 }]}
          onPress={handleSignUp}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color="#000000" />
              <Text style={styles.mainButtonText}>Creating account...</Text>
            </View>
          ) : (
            <Text style={styles.mainButtonText}>Create Account</Text>
          )}
        </TouchableOpacity>

        {/* Divider */}
        <View style={styles.dividerContainer}>
          <View style={styles.dividerLine} />
          <Text style={styles.dividerText}>or</Text>
          <View style={styles.dividerLine} />
        </View>

        {/* Footer */}
        <View style={styles.footer}>
          <Text style={styles.footerText}>Already have an account? </Text>
          <TouchableOpacity onPress={() => router.push('/sign-in' as any)} activeOpacity={0.7}>
            <Text style={styles.footerLink}>Sign in</Text>
          </TouchableOpacity>
        </View>
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
    paddingTop: 50,
    paddingBottom: 40,
    flexGrow: 1,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 28,
    alignSelf: 'flex-start',
  },
  backText: {
    color: '#FFFFFF',
    fontSize: 16,
    marginLeft: 4,
  },
  titleContainer: {
    marginBottom: 24,
  },
  badgeText: {
    color: '#3B82F6',
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
  mainButton: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 24,
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
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 24,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#2A2A2A',
  },
  dividerText: {
    color: '#666666',
    paddingHorizontal: 16,
    fontSize: 13,
  },
  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 8,
    marginBottom: 20,
  },
  footerText: {
    color: '#666666',
    fontSize: 14,
  },
  footerLink: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
