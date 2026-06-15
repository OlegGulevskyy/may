import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  Check,
  ChevronRight,
  LogOut,
  Trash2,
  UserPlus,
  Wifi,
  WifiOff,
} from "lucide-react-native";

import type { FamilyMember } from "@may/core";

import { Surface } from "../ui/Glass";
import { palette, radius } from "../theme";

export function SettingsPanel({
  activeMemberId,
  childName,
  forcedOffline,
  isOnline,
  isSolo,
  members,
  onClearLocalData,
  onInvite,
  onSignOut,
  setActiveMemberId,
  toggleForcedOffline,
}: {
  activeMemberId: string;
  childName: string;
  forcedOffline: boolean;
  isOnline: boolean;
  isSolo: boolean;
  members: FamilyMember[];
  onClearLocalData: () => void;
  onInvite: () => void;
  onSignOut: () => void;
  setActiveMemberId: (memberId: string) => void;
  toggleForcedOffline: () => void;
}) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Settings</Text>
        <Text style={styles.subtitle}>For {childName}&apos;s wall</Text>
      </View>

      <Section
        hint="Whoever is selected is the one adding memories from this device."
        title="Family"
      >
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

      <Section
        hint="Memories always send on their own once you're online. Force offline to feel how queuing works."
        title="Sync"
      >
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
            destructive
            icon={<Trash2 color={palette.berry} size={20} />}
            label="Clear local memories"
            onPress={onClearLocalData}
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

function Section({
  children,
  hint,
  title,
}: {
  children: ReactNode;
  hint?: string;
  title: string;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
      {hint ? <Text style={styles.sectionHint}>{hint}</Text> : null}
    </View>
  );
}

function Row({
  destructive,
  divider,
  icon,
  label,
  onPress,
  showChevron,
  value,
}: {
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
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        divider ? styles.rowDivider : null,
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
  sectionHint: {
    color: palette.inkMuted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
    paddingHorizontal: 4,
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
