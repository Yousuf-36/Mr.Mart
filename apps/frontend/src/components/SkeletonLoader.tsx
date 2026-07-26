/**
 * Skeleton Loader Component — doc 01 §7.
 * Shows loading placeholder cards while fetching data over network.
 */

import React from "react";
import { View, StyleSheet } from "react-native";
import { COLORS, LAYOUT } from "../theme/colors";

export const SkeletonLoader: React.FC = () => {
  return (
    <View style={styles.container}>
      {[1, 2].map((key) => (
        <View key={key} style={styles.card}>
          <View style={styles.badgePlaceholder} />
          <View style={styles.row}>
            <View style={styles.iconPlaceholder} />
            <View style={styles.infoPlaceholder}>
              <View style={styles.lineLong} />
              <View style={styles.lineShort} />
            </View>
          </View>
          <View style={styles.btnPlaceholder} />
        </View>
      ))}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: 16,
  },
  card: {
    backgroundColor: COLORS.cardBg,
    borderRadius: LAYOUT.borderRadius,
    padding: 16,
    borderWidth: 1,
    borderColor: COLORS.borderLight,
    opacity: 0.6,
  },
  badgePlaceholder: {
    width: 120,
    height: 16,
    backgroundColor: COLORS.borderLight,
    borderRadius: 4,
    marginBottom: 12,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  iconPlaceholder: {
    width: 50,
    height: 50,
    borderRadius: 12,
    backgroundColor: COLORS.borderLight,
  },
  infoPlaceholder: {
    flex: 1,
    gap: 8,
    justifyContent: "center",
  },
  lineLong: {
    width: "70%",
    height: 18,
    backgroundColor: COLORS.borderLight,
    borderRadius: 4,
  },
  lineShort: {
    width: "40%",
    height: 12,
    backgroundColor: COLORS.borderLight,
    borderRadius: 4,
  },
  btnPlaceholder: {
    width: "100%",
    height: 56,
    backgroundColor: COLORS.borderLight,
    borderRadius: 10,
  },
});
