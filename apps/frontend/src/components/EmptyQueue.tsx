/**
 * Empty Queue Component — doc 01 §4.
 * Positive/calm visual when no pending actions remain.
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS } from "../theme/colors";

export const EmptyQueue: React.FC = () => {
  return (
    <View style={styles.container}>
      <View style={styles.iconCircle}>
        <Text style={styles.icon}>🎉</Text>
      </View>
      <Text style={styles.title}>All Caught Up!</Text>
      <Text style={styles.sub}>No pending action cards require your approval.</Text>
      <View style={styles.badge}>
        <Text style={styles.badgeText}>✓ AUTOMATIONS RUNNING QUIETLY</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 32,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 40,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: COLORS.statusGreenBg,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  icon: {
    fontSize: 40,
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    color: COLORS.ink,
    marginBottom: 6,
  },
  sub: {
    fontSize: 14,
    color: COLORS.inkMuted,
    textAlign: "center",
    marginBottom: 16,
  },
  badge: {
    backgroundColor: COLORS.statusGreenBg,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: COLORS.statusGreen,
  },
});
