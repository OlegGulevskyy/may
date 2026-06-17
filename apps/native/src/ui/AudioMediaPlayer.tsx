import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import {
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
} from "expo-audio";
import { Pause, Play } from "lucide-react-native";

import type { MemoryMedia } from "@may/core";

import {
  isPlayableAudioUri,
  resolvePlayableAudioUri,
} from "../services/audioPlayback";
import { palette, radius } from "../theme";
import { HapticPressable as Pressable } from "./HapticPressable";

const waveformBarCount = 38;
const waveformMinBarHeight = 6;
const waveformMaxBarHeight = 30;

export function AudioMediaPlayer({
  media,
  style,
}: {
  media: MemoryMedia;
  style?: StyleProp<ViewStyle>;
}) {
  const canPlay = isPlayableAudioUri(media.uri);
  const [playableUri, setPlayableUri] = useState<string | null>(null);
  const [prepareError, setPrepareError] = useState<string | null>(null);
  const audioSource = useMemo(
    () => (playableUri ? { uri: playableUri } : null),
    [playableUri],
  );
  const player = useAudioPlayer(audioSource, { updateInterval: 120 });
  const status = useAudioPlayerStatus(player);
  const loggedErrorRef = useRef<string | null>(null);
  const fallbackDuration = media.durationMs ? media.durationMs / 1000 : 0;
  const duration =
    Number.isFinite(status.duration) && status.duration > 0
      ? status.duration
      : fallbackDuration;
  const currentTime =
    Number.isFinite(status.currentTime) && status.currentTime > 0
      ? Math.min(status.currentTime, duration || status.currentTime)
      : 0;
  const progress = duration > 0 ? Math.min(1, currentTime / duration) : 0;
  const bars = useMemo(() => makeWaveformBars(media), [media]);

  useEffect(() => {
    let cancelled = false;
    setPlayableUri(null);
    setPrepareError(null);

    if (!canPlay) {
      return;
    }

    resolvePlayableAudioUri(media)
      .then((uri) => {
        if (!cancelled) {
          setPlayableUri(uri);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          const message = getErrorMessage(error);
          setPrepareError(message);
          console.warn("[MaySync] audio prepare failed", {
            error: message,
            mediaId: media.id,
            uriScheme: uriScheme(media.uri) ?? "unknown",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canPlay, media]);

  useEffect(() => {
    if (!status.error || loggedErrorRef.current === status.error) {
      return;
    }

    loggedErrorRef.current = status.error;
    console.warn("[MaySync] audio playback failed", {
      error: status.error,
      mediaId: media.id,
      playableUriScheme: playableUri
        ? (uriScheme(playableUri) ?? "unknown")
        : "none",
      uriScheme: uriScheme(media.uri) ?? "unknown",
    });
  }, [media.id, media.uri, playableUri, status.error]);

  useEffect(() => {
    if (status.didJustFinish) {
      player.seekTo(0).catch(() => undefined);
    }
  }, [player, status.didJustFinish]);

  const togglePlayback = useCallback(async () => {
    if (!canPlay) {
      Alert.alert(
        "Voice note unavailable",
        "This voice note does not have a playable audio file on this device.",
      );
      return;
    }

    if (prepareError) {
      Alert.alert("Could not prepare voice note", prepareError);
      return;
    }

    if (!playableUri) {
      Alert.alert("Voice note is loading", "Try again in a moment.");
      return;
    }

    if (status.error) {
      Alert.alert("Could not play voice note", status.error);
      return;
    }

    if (status.playing) {
      player.pause();
      return;
    }

    await setAudioModeAsync({
      allowsRecording: false,
      interruptionMode: "doNotMix",
      playsInSilentMode: true,
      shouldRouteThroughEarpiece: false,
    }).catch(() => undefined);

    if (duration > 0 && currentTime >= duration - 0.15) {
      await player.seekTo(0).catch(() => undefined);
    }

    player.play();
  }, [
    canPlay,
    currentTime,
    duration,
    player,
    playableUri,
    prepareError,
    status.error,
    status.playing,
  ]);

  return (
    <View style={[styles.audioTile, style]}>
      <Pressable
        accessibilityLabel={
          status.playing ? "Pause voice note" : "Play voice note"
        }
        accessibilityRole="button"
        onPress={togglePlayback}
        style={({ pressed }) => [
          styles.audioPlayer,
          pressed ? styles.pressedButton : null,
        ]}
      >
        <View style={styles.audioPlayButton}>
          {status.playing ? (
            <Pause color="#fff" fill="#fff" size={16} />
          ) : (
            <Play color="#fff" fill="#fff" size={16} />
          )}
        </View>
        <View style={styles.waveform}>
          {bars.map((barHeight, barIndex) => {
            const active =
              bars.length > 0 && (barIndex + 1) / bars.length <= progress;
            return (
              <View
                key={`${media.id}-bar-${barIndex}`}
                style={[
                  styles.waveformBar,
                  {
                    backgroundColor: active ? palette.ink : palette.inkFaint,
                    height: barHeight,
                  },
                ]}
              />
            );
          })}
        </View>
      </Pressable>
      <Text style={styles.audioDurationText}>
        {duration > 0
          ? `${formatMediaDuration(currentTime)} / ${formatMediaDuration(duration)}`
          : "--:--"}
      </Text>
    </View>
  );
}

const waveformPeakToHeight = (peak: number) =>
  waveformMinBarHeight +
  Math.round(
    Math.max(0, Math.min(1, peak)) *
      (waveformMaxBarHeight - waveformMinBarHeight),
  );

const resampleWaveformPeaks = (peaks: number[]) =>
  Array.from({ length: waveformBarCount }, (_, index) => {
    const start = Math.floor((index * peaks.length) / waveformBarCount);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) * peaks.length) / waveformBarCount),
    );
    const bucket = peaks.slice(start, end);
    return bucket.length > 0 ? Math.max(...bucket) : 0;
  });

const makeWaveformBars = (media: MemoryMedia) => {
  const realPeaks = Array.isArray(media.waveformPeaks)
    ? media.waveformPeaks.filter(
        (peak) => Number.isFinite(peak) && peak >= 0 && peak <= 1,
      )
    : [];

  if (realPeaks.length > 0) {
    return resampleWaveformPeaks(realPeaks).map(waveformPeakToHeight);
  }

  return makeGeneratedWaveformBars(media.id, media.durationMs ?? 0);
};

const makeGeneratedWaveformBars = (seed: string, durationMs: number) => {
  let hash = 2166136261;
  const input = `${seed}:${durationMs}`;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return Array.from({ length: waveformBarCount }, (_, index) => {
    hash ^= index + 1;
    hash = Math.imul(hash, 16777619);
    const normalized = (hash >>> 0) / 4294967295;
    const envelope =
      0.55 + Math.sin((index / (waveformBarCount - 1)) * Math.PI) * 0.45;
    const height =
      waveformMinBarHeight +
      Math.round(
        (waveformMaxBarHeight - waveformMinBarHeight) *
          (0.28 + normalized * 0.72) *
          envelope,
      );

    return Math.max(
      waveformMinBarHeight,
      Math.min(waveformMaxBarHeight, height),
    );
  });
};

function formatMediaDuration(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0:00";
  }

  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;

  return `${minutes}:${remainingSeconds.toString().padStart(2, "0")}`;
}

const uriScheme = (uri: string) => uri.match(/^([a-z][a-z0-9+.-]*):/i)?.[1];

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong.";
}

const styles = StyleSheet.create({
  audioTile: {
    gap: 3,
    justifyContent: "center",
  },
  audioPlayer: {
    alignItems: "center",
    borderRadius: radius.pill,
    flexDirection: "row",
    gap: 10,
    minHeight: 46,
  },
  audioPlayButton: {
    alignItems: "center",
    backgroundColor: palette.ink,
    borderRadius: radius.pill,
    height: 36,
    justifyContent: "center",
    width: 36,
  },
  waveform: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 3,
    height: waveformMaxBarHeight,
  },
  waveformBar: {
    borderRadius: 2,
    flex: 1,
    maxWidth: 4,
    minWidth: 2,
  },
  audioDurationText: {
    color: palette.inkMuted,
    fontSize: 11,
    fontWeight: "800",
    textAlign: "center",
  },
  pressedButton: {
    opacity: 0.82,
    transform: [{ scale: 0.985 }],
  },
});
