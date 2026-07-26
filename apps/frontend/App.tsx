/**
 * Mr. Mart — Stage 0 splash screen.
 * Full app screens are built from Stage 1 onward.
 * See docs/01 §7 for the Cherry Bold design system.
 */

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
} from 'react-native';

const CHERRY_RED = '#990011';
const BG = '#FCF6F5';
const INK = '#241111';

export default function App() {
  return (
    <View style={styles.container}>
      <StatusBar backgroundColor={CHERRY_RED} barStyle="light-content" />
      <View style={styles.logoBlock}>
        <Text style={styles.logo}>🛒</Text>
        <Text style={styles.title}>Mr. Mart</Text>
        <Text style={styles.sub}>AI Automation for Mini Supermarkets</Text>
      </View>
      <ActivityIndicator size="large" color={CHERRY_RED} style={styles.spinner} />
      <Text style={styles.stage}>Stage 0 — Skeleton</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoBlock: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logo: {
    fontSize: 72,
    marginBottom: 12,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: CHERRY_RED,
    letterSpacing: 1,
  },
  sub: {
    fontSize: 14,
    color: INK,
    opacity: 0.6,
    marginTop: 6,
    textAlign: 'center',
  },
  spinner: {
    marginTop: 24,
  },
  stage: {
    fontSize: 12,
    color: INK,
    opacity: 0.4,
    marginTop: 16,
  },
});
