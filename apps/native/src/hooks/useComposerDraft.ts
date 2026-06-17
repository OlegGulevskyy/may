import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from "expo-audio";

import type { MemoryMedia, MemoryMediaKind } from "@may/core";

import {
  persistPickedAsset,
  persistRecordedAudio,
} from "../services/localMedia";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

const recordingWaveformBarCount = 38;
const recordingPreviewBarCount = 6;
const idleRecordingWaveformPreview = Array.from(
  { length: recordingPreviewBarCount },
  (_, index) => 0.18 + (index % 3) * 0.08,
);

const clamp = (value: number, min = 0, max = 1) =>
  Math.max(min, Math.min(max, value));

const meteringToPeak = (metering: number) => {
  if (!Number.isFinite(metering)) {
    return 0;
  }

  if (metering >= 0 && metering <= 1) {
    return clamp(metering);
  }

  const normalizedDb = (clamp(metering, -60, 0) + 60) / 60;
  return clamp(Math.pow(normalizedDb, 1.35));
};

const finalizeWaveformPeaks = (samples: number[]) => {
  if (samples.length === 0) {
    return undefined;
  }

  const bucketCount = recordingWaveformBarCount;
  const peaks = Array.from({ length: bucketCount }, (_, index) => {
    const start = Math.floor((index * samples.length) / bucketCount);
    const end = Math.max(
      start + 1,
      Math.floor(((index + 1) * samples.length) / bucketCount),
    );
    const bucket = samples.slice(start, end);
    return bucket.length > 0 ? Math.max(...bucket) : 0;
  });
  const maxPeak = Math.max(...peaks);

  if (maxPeak <= 0.001) {
    return peaks.map(() => 0);
  }

  return peaks.map((peak) =>
    Number((peak > 0 ? Math.max(0.08, peak / maxPeak) : 0).toFixed(3)),
  );
};

/**
 * Owns a single memory draft: its text, attachments, and the camera / library /
 * voice capture flows. Lives in its own hook so the compose screen can stay
 * focused on layout. Optionally seeds from an existing draft being resumed.
 */
export function useComposerDraft(initial?: {
  body?: string;
  media?: MemoryMedia[];
}) {
  const [body, setBody] = useState(initial?.body ?? "");
  const [attachments, setAttachments] = useState<MemoryMedia[]>(
    initial?.media ?? [],
  );
  const [isPicking, setIsPicking] = useState(false);

  const audioRecorder = useAudioRecorder({
    ...RecordingPresets.HIGH_QUALITY,
    directory: "document",
    isMeteringEnabled: true,
  });
  const recorderState = useAudioRecorderState(audioRecorder, 80);
  const waveformSamplesRef = useRef<number[]>([]);
  const lastWaveformSampleAtMsRef = useRef(0);
  const [recordingWaveformPreview, setRecordingWaveformPreview] = useState<
    number[]
  >(idleRecordingWaveformPreview);

  useEffect(() => {
    const prepareAudio = async () => {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        return;
      }
      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
    };
    prepareAudio().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!recorderState.isRecording) {
      return;
    }

    const metering = recorderState.metering;
    const durationMs = recorderState.durationMillis ?? 0;
    if (
      typeof metering !== "number" ||
      !Number.isFinite(metering) ||
      durationMs - lastWaveformSampleAtMsRef.current < 45
    ) {
      return;
    }

    const peak = meteringToPeak(metering);
    lastWaveformSampleAtMsRef.current = durationMs;
    waveformSamplesRef.current.push(peak);
    setRecordingWaveformPreview((current) => [...current.slice(1), peak]);
  }, [
    recorderState.durationMillis,
    recorderState.isRecording,
    recorderState.metering,
  ]);

  const addPickedAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset, kind: MemoryMediaKind) => {
      const persisted = await persistPickedAsset(asset, kind);
      setAttachments((current) => [...current, persisted]);
      return persisted;
    },
    [],
  );

  const capture = useCallback(
    async (kind: "image" | "video"): Promise<MemoryMedia[]> => {
      try {
        setIsPicking(true);
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("Camera permission", "Camera access is needed first.");
          return [];
        }
        const result = await ImagePicker.launchCameraAsync({
          mediaTypes: [kind === "image" ? "images" : "videos"],
          preferredAssetRepresentationMode:
            ImagePicker.UIImagePickerPreferredAssetRepresentationMode
              .Compatible,
          quality: 0.85,
          videoMaxDuration: 90,
        });
        if (!result.canceled && result.assets[0]) {
          return [await addPickedAsset(result.assets[0], kind)];
        }
      } catch (error) {
        Alert.alert("Capture failed", getErrorMessage(error));
      } finally {
        setIsPicking(false);
      }
      return [];
    },
    [addPickedAsset],
  );

  const pickFromLibrary = useCallback(async (): Promise<MemoryMedia[]> => {
    try {
      setIsPicking(true);
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photo permission", "Library access is needed first.");
        return [];
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsMultipleSelection: true,
        mediaTypes: ["images", "videos"],
        preferredAssetRepresentationMode:
          ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
        quality: 0.9,
        selectionLimit: 6,
      });
      if (!result.canceled) {
        const next = await Promise.all(
          result.assets.map((asset) =>
            persistPickedAsset(
              asset,
              asset.type === "video" ? "video" : "image",
            ),
          ),
        );
        setAttachments((current) => [...current, ...next]);
        return next;
      }
    } catch (error) {
      Alert.alert("Picker failed", getErrorMessage(error));
    } finally {
      setIsPicking(false);
    }
    return [];
  }, []);

  const toggleRecording = useCallback(async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert("Microphone permission", "Microphone access is needed.");
        return;
      }
      if (recorderState.isRecording) {
        const durationMs = recorderState.durationMillis ?? 0;
        const waveformPeaks = finalizeWaveformPeaks(waveformSamplesRef.current);
        await audioRecorder.stop();
        const recordingUri = audioRecorder.uri;
        waveformSamplesRef.current = [];
        lastWaveformSampleAtMsRef.current = 0;
        setRecordingWaveformPreview(idleRecordingWaveformPreview);
        if (!recordingUri) {
          return;
        }
        const persisted = await persistRecordedAudio(
          recordingUri,
          durationMs,
          waveformPeaks,
        );
        setAttachments((current) => [...current, persisted]);
        return;
      }
      waveformSamplesRef.current = [];
      lastWaveformSampleAtMsRef.current = 0;
      setRecordingWaveformPreview(idleRecordingWaveformPreview);
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
    } catch (error) {
      Alert.alert("Recording failed", getErrorMessage(error));
    }
  }, [audioRecorder, recorderState.durationMillis, recorderState.isRecording]);

  const removeAttachment = useCallback((id: string) => {
    setAttachments((current) => current.filter((item) => item.id !== id));
  }, []);

  const reset = useCallback(() => {
    setBody("");
    setAttachments([]);
  }, []);

  const canSubmit = body.trim().length > 0 || attachments.length > 0;

  return {
    attachments,
    body,
    canSubmit,
    capture,
    isPicking,
    isRecording: recorderState.isRecording,
    pickFromLibrary,
    recordingWaveformPreview,
    removeAttachment,
    reset,
    setBody,
    toggleRecording,
  };
}
