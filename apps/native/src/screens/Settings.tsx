import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Check,
  ChevronRight,
  CloudUpload,
  HardDrive,
  LogOut,
  MailCheck,
  Trash2,
  UserPlus,
  Wifi,
  WifiOff,
} from "lucide-react-native";

import type { FamilyMember, GoogleDeliveryConnection } from "@may/core";

import { Surface } from "../ui/Glass";
import {
  clearImageCache,
  getImageCacheSizeBytes,
} from "../services/imageCache";
import { palette, radius } from "../theme";

export function SettingsPanel({
  activeMemberId,
  childName,
  forcedOffline,
  googleDeliveryConnection,
  isOnline,
  isSolo,
  members,
  onConnectGoogleDelivery,
  onInvite,
  onSignOut,
  setActiveMemberId,
  toggleForcedOffline,
}: {
  activeMemberId: string;
  childName: string;
  forcedOffline: boolean;
  googleDeliveryConnection?: GoogleDeliveryConnection;
  isOnline: boolean;
  isSolo: boolean;
  members: FamilyMember[];
  onConnectGoogleDelivery: () => Promise<unknown>;
  onInvite: () => void;
  onSignOut: () => void;
  setActiveMemberId: (memberId: string) => void;
  toggleForcedOffline: () => void;
}) {
  const [cacheSizeBytes, setCacheSizeBytes] = useState<number | null>(null);
  const [cacheBusy, setCacheBusy] = useState(false);
  const [deliveryBusy, setDeliveryBusy] = useState(false);
  const deliveryConnected = googleDeliveryConnection?.status === "connected";
  const deliveryNeedsReconnect =
    googleDeliveryConnection?.status === "needs_reconnect";

  const loadCacheSize = useCallback(async () => {
    try {
      const bytes = await getImageCacheSizeBytes();
      setCacheSizeBytes(bytes);
    } catch (error) {
      console.warn("[MaySync] image cache size failed", {
        error: getErrorMessage(error),
      });
      setCacheSizeBytes(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    getImageCacheSizeBytes()
      .then((bytes) => {
        if (!cancelled) {
          setCacheSizeBytes(bytes);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("[MaySync] image cache size failed", {
            error: getErrorMessage(error),
          });
          setCacheSizeBytes(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const confirmClearImageCache = useCallback(() => {
    Alert.alert(
      "Clear application cache?",
      "Cached wall images will download again when needed.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Clear",
          style: "destructive",
          onPress: () => {
            setCacheBusy(true);
            clearImageCache()
              .then(loadCacheSize)
              .catch((error) =>
                Alert.alert("Could not clear cache", getErrorMessage(error)),
              )
              .finally(() => setCacheBusy(false));
          },
        },
      ],
    );
  }, [loadCacheSize]);

  const connectGoogleDelivery = useCallback(() => {
    setDeliveryBusy(true);
    onConnectGoogleDelivery()
      .then(() =>
        Alert.alert(
          "Google delivery connected",
          "May can now send emails and upload files with this Google account.",
        ),
      )
      .catch((error) =>
        Alert.alert(
          "Could not connect Google delivery",
          getErrorMessage(error),
        ),
      )
      .finally(() => setDeliveryBusy(false));
  }, [onConnectGoogleDelivery]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>For {childName}&apos;s wall</Text>
      </View>

      <Section title="Family">
        <Surface style={styles.group}>
          {members.map((member, index) => {
            const selected = activeMemberId === member.id;
            return (
              <Pressable
                accessibilityLabel={`Post as ${member.displayName}`}
                accessibilityRole="button"
                key={member.id}
                onPress={() => setActiveMemberId(member.id)}
                style={({ pressed }) => [
                  styles.row,
                  index > 0 ? styles.rowDivider : null,
                  pressed ? styles.rowPressed : null,
                ]}
              >
                <View
                  style={[styles.avatar, selected ? styles.avatarActive : null]}
                >
                  <Text
                    style={[
                      styles.avatarText,
                      selected ? styles.avatarTextActive : null,
                    ]}
                  >
                    {member.initials}
                  </Text>
                </View>
                <View style={styles.rowText}>
                  <Text style={styles.rowTitle}>{member.displayName}</Text>
                  <Text style={styles.rowMeta}>{member.role}</Text>
                </View>
                {selected ? (
                  <View style={styles.activePill}>
                    <Check color={palette.moss} size={15} />
                    <Text style={styles.activePillText}>Active</Text>
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </Surface>
      </Section>

      <Section title="Delivery">
        <Surface style={styles.group}>
          <Row
            disabled={deliveryBusy}
            icon={
              deliveryConnected ? (
                <MailCheck color={palette.moss} size={20} />
              ) : (
                <CloudUpload color={palette.berry} size={20} />
              )
            }
            label="Google delivery"
            onPress={connectGoogleDelivery}
            showChevron
            value={
              deliveryBusy
                ? "Connecting"
                : deliveryConnected
                  ? "Connected"
                  : deliveryNeedsReconnect
                    ? "Reconnect"
                    : "Connect"
            }
          />
        </Surface>
      </Section>

      <Section title="Sync">
        <Surface style={styles.group}>
          <Row
            icon={
              isOnline ? (
                <Wifi color={palette.moss} size={20} />
              ) : (
                <WifiOff color={palette.berry} size={20} />
              )
            }
            label="Force offline"
            onPress={toggleForcedOffline}
            value={forcedOffline ? "On" : "Off"}
          />
          {isSolo ? (
            <Row
              divider
              icon={<UserPlus color={palette.berry} size={20} />}
              label="Invite someone close"
              onPress={onInvite}
              showChevron
            />
          ) : null}
        </Surface>
      </Section>

      <Section title="This device">
        <Surface style={styles.group}>
          <Row
            icon={<HardDrive color={palette.moss} size={20} />}
            label="Application cache"
            onPress={loadCacheSize}
            value={
              cacheBusy
                ? "Clearing"
                : cacheSizeBytes === null
                  ? "Calculating"
                  : formatCacheSize(cacheSizeBytes)
            }
          />
          <Row
            destructive
            disabled={cacheBusy}
            divider
            icon={<Trash2 color={palette.berry} size={20} />}
            label="Clear application cache"
            onPress={confirmClearImageCache}
            showChevron
          />
          <Row
            destructive
            divider
            icon={<LogOut color={palette.berry} size={20} />}
            label="Sign out"
            onPress={onSignOut}
            showChevron
          />
        </Surface>
      </Section>
    </View>
  );
}

function Section({ children, title }: { children: ReactNode; title: string }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Row({
  disabled,
  destructive,
  divider,
  icon,
  label,
  onPress,
  showChevron,
  value,
}: {
  disabled?: boolean;
  destructive?: boolean;
  divider?: boolean;
  icon: ReactNode;
  label: string;
  onPress: () => void;
  showChevron?: boolean;
  value?: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divider ? styles.rowDivider : null,
        disabled ? styles.rowDisabled : null,
        pressed ? styles.rowPressed : null,
      ]}
    >
      <View style={styles.rowIcon}>{icon}</View>
      <Text
        style={[styles.rowLabel, destructive ? styles.rowLabelDanger : null]}
      >
        {label}
      </Text>
      {value ? <Text style={styles.rowValue}>{value}</Text> : null}
      {showChevron ? <ChevronRight color={palette.inkFaint} size={18} /> : null}
    </Pressable>
  );
}

function formatCacheSize(bytes: number) {
  if (bytes === 0) {
    return "0 MB";
  }

  const gib = bytes / 1024 / 1024 / 1024;
  if (gib >= 1) {
    return `${gib >= 10 ? gib.toFixed(1) : gib.toFixed(2)} GB`;
  }

  const mib = bytes / 1024 / 1024;
  if (mib < 0.1) {
    return "< 0.1 MB";
  }

  return `${mib >= 10 ? mib.toFixed(1) : mib.toFixed(2)} MB`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const styles = StyleSheet.create({
  container: {
    gap: 24,
  },
  header: {
    gap: 4,
    paddingTop: 4,
  },
  title: {
    color: palette.ink,
    fontSize: 28,
    fontWeight: "900",
  },
  subtitle: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "700",
  },
  section: {
    gap: 10,
  },
  sectionTitle: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "900",
    letterSpacing: 0.8,
    paddingHorizontal: 4,
    textTransform: "uppercase",
  },
  group: {
    overflow: "hidden",
    paddingHorizontal: 6,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: 13,
    minHeight: 60,
    paddingHorizontal: 10,
  },
  rowDivider: {
    borderTopColor: "rgba(37,45,43,0.07)",
    borderTopWidth: 1,
  },
  rowPressed: {
    opacity: 0.6,
  },
  rowDisabled: {
    opacity: 0.45,
  },
  rowIcon: {
    alignItems: "center",
    width: 24,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  rowMeta: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  rowLabel: {
    color: palette.ink,
    flex: 1,
    fontSize: 16,
    fontWeight: "800",
  },
  rowLabelDanger: {
    color: palette.berry,
  },
  rowValue: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: "800",
  },
  avatar: {
    alignItems: "center",
    backgroundColor: "rgba(37,45,43,0.08)",
    borderRadius: radius.pill,
    height: 40,
    justifyContent: "center",
    width: 40,
  },
  avatarActive: {
    backgroundColor: palette.ink,
  },
  avatarText: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: "900",
  },
  avatarTextActive: {
    color: "#fff",
  },
  activePill: {
    alignItems: "center",
    backgroundColor: "rgba(91,126,102,0.14)",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  activePillText: {
    color: palette.moss,
    fontSize: 12,
    fontWeight: "900",
  },
});
