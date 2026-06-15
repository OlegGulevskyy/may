import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ColorValue,
} from "react-native";
import {
  Archive,
  Clock,
  Cloud,
  CheckCheck,
  Mail,
  Save,
  TriangleAlert,
  UploadCloud,
  X,
  type LucideIcon,
} from "lucide-react-native";

import type { MemoryDeliveryStatus } from "@may/core";

import { palette, radius } from "../theme";

type StatusMeta = {
  icon: LucideIcon;
  tint: ColorValue;
  title: string;
  description: string;
};

/**
 * Human-facing meaning for each delivery stage. The wording stays calm and
 * jargon-free on purpose — syncing is a background concern, so the UI explains
 * it gently rather than exposing Firebase/Drive/Gmail plumbing.
 */
export const STATUS_META: Record<MemoryDeliveryStatus, StatusMeta> = {
  local: {
    icon: Save,
    tint: palette.inkMuted,
    title: "Saved on your phone",
    description: "Kept safely on this device.",
  },
  queued: {
    icon: Clock,
    tint: palette.gold,
    title: "Waiting to sync",
    description: "Uploads once May can reach your private cloud.",
  },
  synced: {
    icon: Cloud,
    tint: palette.moss,
    title: "Backed up",
    description: "Safely saved to your private cloud.",
  },
  uploading: {
    icon: UploadCloud,
    tint: palette.gold,
    title: "Uploading",
    description: "Sending the photos and video across.",
  },
  stored: {
    icon: Archive,
    tint: palette.moss,
    title: "Stored",
    description: "Tucked away and ready to send.",
  },
  emailing: {
    icon: Mail,
    tint: palette.gold,
    title: "Sending",
    description: "On its way to the inbox.",
  },
  delivered: {
    icon: CheckCheck,
    tint: palette.moss,
    title: "Delivered",
    description: "Safely arrived. Nothing more to do.",
  },
  failed: {
    icon: TriangleAlert,
    tint: palette.berry,
    title: "Needs another try",
    description: "Something interrupted it — tap retry to send again.",
  },
};

// The order memories travel through, for the legend.
const LEGEND_ORDER: MemoryDeliveryStatus[] = [
  "local",
  "queued",
  "synced",
  "uploading",
  "stored",
  "emailing",
  "delivered",
  "failed",
];

/** Compact, tappable status indicator shown on each memory card. */
export function StatusGlyph({
  status,
  onPress,
}: {
  status: MemoryDeliveryStatus;
  onPress: () => void;
}) {
  const meta = STATUS_META[status];
  const Icon = meta.icon;

  return (
    <Pressable
      accessibilityLabel={`Status: ${meta.title}. Tap to learn more.`}
      accessibilityRole="button"
      hitSlop={10}
      onPress={onPress}
      style={({ pressed }) => [
        styles.glyph,
        pressed ? styles.glyphPressed : null,
      ]}
    >
      <Icon color={meta.tint} size={18} />
    </Pressable>
  );
}

/** Bottom-sheet style legend explaining every status icon. */
export function StatusLegend({
  visible,
  onClose,
}: {
  visible: boolean;
  onClose: () => void;
}) {
  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      transparent
      visible={visible}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => undefined}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>What the icons mean</Text>
            <Pressable
              accessibilityLabel="Close"
              accessibilityRole="button"
              hitSlop={10}
              onPress={onClose}
              style={styles.closeButton}
            >
              <X color={palette.inkMuted} size={18} />
            </Pressable>
          </View>

          <View style={styles.list}>
            {LEGEND_ORDER.map((status) => {
              const meta = STATUS_META[status];
              const Icon = meta.icon;
              return (
                <View key={status} style={styles.row}>
                  <View style={styles.rowIcon}>
                    <Icon color={meta.tint} size={19} />
                  </View>
                  <View style={styles.rowText}>
                    <Text style={styles.rowTitle}>{meta.title}</Text>
                    <Text style={styles.rowDescription}>
                      {meta.description}
                    </Text>
                  </View>
                </View>
              );
            })}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  glyph: {
    alignItems: "center",
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  glyphPressed: {
    opacity: 0.5,
  },
  backdrop: {
    backgroundColor: "rgba(31,28,24,0.32)",
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: palette.porcelain,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    gap: 18,
    paddingBottom: 36,
    paddingHorizontal: 22,
    paddingTop: 20,
  },
  sheetHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  sheetTitle: {
    color: palette.ink,
    fontSize: 19,
    fontWeight: "900",
  },
  closeButton: {
    alignItems: "center",
    backgroundColor: "rgba(37,45,43,0.06)",
    borderRadius: radius.pill,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  list: {
    gap: 16,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 14,
  },
  rowIcon: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.7)",
    borderRadius: radius.medium,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: palette.ink,
    fontSize: 15,
    fontWeight: "800",
  },
  rowDescription: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
  },
});
