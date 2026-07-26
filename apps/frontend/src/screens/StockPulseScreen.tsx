/**
 * Stock Pulse Screen — doc 01 §6.
 * Read-only monitoring screen displaying current stock levels per product
 * with visual status rings (Green / Yellow / Red).
 */

import React, { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from "react-native";
import { COLORS, LAYOUT } from "../theme/colors";

export interface StockItem {
  sku: string;
  name: string;
  category: string;
  unit: string;
  qty: number;
  reorder_point: number;
  shelf_capacity: number;
  status: "green" | "yellow" | "red";
}

interface StockPulseScreenProps {
  backendUrl?: string;
  initialItems?: StockItem[];
}

export const StockPulseScreen: React.FC<StockPulseScreenProps> = ({
  backendUrl = "http://localhost:3001",
  initialItems,
}) => {
  const [items, setItems] = useState<StockItem[]>(initialItems || []);
  const [loading, setLoading] = useState(!initialItems);

  useEffect(() => {
    if (initialItems) return;
    fetch(`${backendUrl}/api/monitoring/stock`)
      .then((res) => res.json())
      .then((data) => setItems(data.items || []))
      .catch((err) => console.warn("[Stock Pulse] Fetch error:", err))
      .finally(() => setLoading(false));
  }, [backendUrl, initialItems]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Stock Pulse</Text>
        <Text style={styles.sub}>Read-Only Inventory Monitor</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {loading ? (
          <ActivityIndicator size="large" color={COLORS.brandRed} style={{ marginTop: 40 }} />
        ) : (
          items.map((item) => {
            const pct = Math.min(100, Math.round((item.qty / item.shelf_capacity) * 100));
            const statusColor =
              item.status === "red"
                ? COLORS.alertRed
                : item.status === "yellow"
                ? COLORS.statusYellow
                : COLORS.statusGreen;

            return (
              <View key={item.sku} style={styles.row}>
                {/* Status Ring Motif */}
                <View style={[styles.statusRing, { borderColor: statusColor }]}>
                  <Text style={styles.categoryIcon}>
                    {item.category === "Grains" ? "🌾" : item.category === "Dairy" ? "🥛" : item.category === "Bakery" ? "🍞" : "📦"}
                  </Text>
                </View>

                <View style={styles.info}>
                  <Text style={styles.name}>{item.name}</Text>
                  <Text style={styles.subText}>
                    Reorder Point: {item.reorder_point} {item.unit}s
                  </Text>

                  {/* Battery Fill Bar */}
                  <View style={styles.batteryTrack}>
                    <View style={[styles.batteryFill, { width: `${pct}%`, backgroundColor: statusColor }]} />
                  </View>
                </View>

                <View style={styles.qtyBlock}>
                  <Text style={[styles.qtyNum, { color: statusColor }]}>{item.qty}</Text>
                  <Text style={styles.qtyUnit}>{item.unit}s</Text>
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  header: {
    backgroundColor: COLORS.brandRed,
    paddingTop: 44,
    paddingBottom: 16,
    paddingHorizontal: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: "900",
    color: "#FFFFFF",
  },
  sub: {
    fontSize: 12,
    color: "#FFCDD2",
    marginTop: 2,
  },
  scroll: {
    padding: 16,
    gap: 12,
  },
  row: {
    backgroundColor: COLORS.cardBg,
    borderRadius: LAYOUT.borderRadius,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: COLORS.borderLight,
  },
  statusRing: {
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: 3,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  categoryIcon: {
    fontSize: 22,
  },
  info: {
    flex: 1,
    marginRight: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: "700",
    color: COLORS.ink,
    marginBottom: 2,
  },
  subText: {
    fontSize: 11,
    color: COLORS.inkMuted,
    marginBottom: 6,
  },
  batteryTrack: {
    height: 8,
    backgroundColor: COLORS.borderLight,
    borderRadius: 4,
    overflow: "hidden",
  },
  batteryFill: {
    height: "100%",
    borderRadius: 4,
  },
  qtyBlock: {
    alignItems: "flex-end",
  },
  qtyNum: {
    fontSize: 24,
    fontWeight: "900",
  },
  qtyUnit: {
    fontSize: 10,
    fontWeight: "700",
    color: COLORS.inkMuted,
  },
});
