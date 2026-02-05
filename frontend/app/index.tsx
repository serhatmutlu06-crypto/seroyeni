import React, { useState, useEffect, useCallback } from 'react';
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  Dimensions,
  Platform,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';

const { width, height } = Dimensions.get('window');
const EXPO_PUBLIC_BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || '';

interface UserState {
  device_id: string;
  can_reveal: boolean;
  seconds_until_available: number;
  next_available_time: string | null;
  current_day: number;
  is_complete: boolean;
}

interface RevealResult {
  before_red: string;
  red_word: string;
  after_red: string;
  day: number;
  next_available_time: string;
  is_final_day: boolean;
}

type AppState = 'ready' | 'revealing' | 'showing_sentence' | 'cooldown' | 'complete';

export default function MysteryReveal() {
  const [deviceId, setDeviceId] = useState<string>('');
  const [userState, setUserState] = useState<UserState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [appState, setAppState] = useState<AppState>('ready');
  const [sentenceData, setSentenceData] = useState<RevealResult | null>(null);
  const [countdown, setCountdown] = useState<number>(0);

  const buttonOpacity = useSharedValue(1);
  const sentenceOpacity = useSharedValue(0);
  const cooldownOpacity = useSharedValue(0);

  // Generate or get device ID
  useEffect(() => {
    const initDeviceId = async () => {
      try {
        let id = await AsyncStorage.getItem('mystery_device_id_v2');
        if (!id) {
          id = 'mystery_' + Math.random().toString(36).substr(2, 9) + Date.now();
          await AsyncStorage.setItem('mystery_device_id_v2', id);
        }
        setDeviceId(id);
      } catch (e) {
        const fallbackId = 'mystery_' + Math.random().toString(36).substr(2, 9);
        setDeviceId(fallbackId);
      }
    };
    initDeviceId();
  }, []);

  // Fetch user state when device ID is ready
  useEffect(() => {
    if (deviceId) {
      fetchUserState();
    }
  }, [deviceId]);

  // Countdown timer
  useEffect(() => {
    if (countdown > 0 && appState === 'cooldown') {
      const timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            fetchUserState();
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      return () => clearInterval(timer);
    }
  }, [countdown > 0, appState]);

  const fetchUserState = async () => {
    try {
      const response = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/user/${deviceId}`);
      if (response.ok) {
        const data: UserState = await response.json();
        setUserState(data);
        
        if (data.is_complete) {
          setAppState('complete');
          buttonOpacity.value = 0;
          cooldownOpacity.value = 1;
        } else if (!data.can_reveal && data.seconds_until_available > 0) {
          setCountdown(data.seconds_until_available);
          setAppState('cooldown');
          buttonOpacity.value = 0;
          cooldownOpacity.value = 1;
        } else {
          setAppState('ready');
          buttonOpacity.value = 1;
          cooldownOpacity.value = 0;
        }
      }
    } catch (error) {
      console.error('Error fetching user state:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const transitionToCooldown = useCallback(() => {
    setAppState('cooldown');
    cooldownOpacity.value = withTiming(1, { duration: 800, easing: Easing.out(Easing.ease) });
  }, []);

  const handleReveal = async () => {
    if (appState !== 'ready') return;

    // Haptic feedback
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }

    setAppState('revealing');
    
    // Fade out button
    buttonOpacity.value = withTiming(0, { duration: 400 });

    try {
      const response = await fetch(`${EXPO_PUBLIC_BACKEND_URL}/api/reveal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ device_id: deviceId }),
      });

      if (response.ok) {
        const data: RevealResult = await response.json();
        setSentenceData(data);
        setCountdown(24 * 60 * 60);

        // Show sentence
        setAppState('showing_sentence');
        sentenceOpacity.value = withTiming(1, { 
          duration: 1000, 
          easing: Easing.out(Easing.ease) 
        });

        // After 5 seconds, fade out sentence and show cooldown
        setTimeout(() => {
          sentenceOpacity.value = withTiming(0, { 
            duration: 800, 
            easing: Easing.in(Easing.ease) 
          });
          
          setTimeout(() => {
            if (data.is_final_day) {
              setAppState('complete');
              cooldownOpacity.value = withTiming(1, { duration: 800 });
            } else {
              transitionToCooldown();
            }
          }, 800);
        }, 5000);

      } else {
        fetchUserState();
      }
    } catch (error) {
      console.error('Error revealing:', error);
      fetchUserState();
    }
  };

  const formatCountdown = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, '0')}:${minutes
      .toString()
      .padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const buttonAnimatedStyle = useAnimatedStyle(() => ({
    opacity: buttonOpacity.value,
  }));

  const sentenceAnimatedStyle = useAnimatedStyle(() => ({
    opacity: sentenceOpacity.value,
  }));

  const cooldownAnimatedStyle = useAnimatedStyle(() => ({
    opacity: cooldownOpacity.value,
  }));

  if (isLoading) {
    return (
      <View style={styles.container}>
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Reveal Button */}
      {appState === 'ready' && (
        <Animated.View style={[styles.buttonContainer, buttonAnimatedStyle]}>
          <TouchableOpacity
            onPress={handleReveal}
            activeOpacity={0.7}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Reveal</Text>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* Loading state while revealing */}
      {appState === 'revealing' && (
        <View style={styles.centerContent}>
          <View style={styles.loadingDot} />
        </View>
      )}

      {/* Sentence Display with Red Word */}
      {appState === 'showing_sentence' && sentenceData && (
        <Animated.View style={[styles.sentenceContainer, sentenceAnimatedStyle]}>
          <Text style={styles.sentenceText}>
            {sentenceData.before_red}{' '}
            <Text style={styles.redWord}>{sentenceData.red_word}</Text>
            {sentenceData.after_red.startsWith('.') || sentenceData.after_red.startsWith(',') 
              ? sentenceData.after_red 
              : ' ' + sentenceData.after_red}
          </Text>
        </Animated.View>
      )}

      {/* Cooldown State */}
      {appState === 'cooldown' && (
        <Animated.View style={[styles.cooldownContainer, cooldownAnimatedStyle]}>
          <Text style={styles.cooldownMessage}>Come back tomorrow.</Text>
          <Text style={styles.countdownTimer}>{formatCountdown(countdown)}</Text>
        </Animated.View>
      )}

      {/* Complete State - All 10 days done */}
      {appState === 'complete' && (
        <Animated.View style={[styles.cooldownContainer, cooldownAnimatedStyle]}>
          <Text style={styles.completeMessage}>The sequence is complete.</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  button: {
    paddingVertical: 16,
    paddingHorizontal: 48,
    borderWidth: 1,
    borderColor: '#333333',
    borderRadius: 4,
    backgroundColor: 'transparent',
  },
  buttonText: {
    color: '#888888',
    fontSize: 16,
    fontWeight: '300',
    letterSpacing: 3,
    textTransform: 'lowercase',
  },
  centerContent: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#444444',
  },
  sentenceContainer: {
    paddingHorizontal: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sentenceText: {
    color: '#666666',
    fontSize: 18,
    fontWeight: '300',
    textAlign: 'center',
    lineHeight: 28,
    letterSpacing: 0.5,
  },
  redWord: {
    color: '#cc0000',
    fontWeight: '500',
  },
  cooldownContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cooldownMessage: {
    color: '#444444',
    fontSize: 14,
    fontWeight: '300',
    letterSpacing: 1,
    marginBottom: 24,
  },
  countdownTimer: {
    color: '#555555',
    fontSize: 32,
    fontWeight: '200',
    letterSpacing: 4,
    fontVariant: ['tabular-nums'],
  },
  completeMessage: {
    color: '#444444',
    fontSize: 14,
    fontWeight: '300',
    letterSpacing: 1,
  },
});
