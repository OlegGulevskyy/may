import { useCallback, useEffect, useState } from "react";
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

import { persistPickedAsset } from "../services/localMedia";

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong.";

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
  });
  const recorderState = useAudioRecorderState(audioRecorder);

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

  const addPickedAsset = useCallback(
    async (asset: ImagePicker.ImagePickerAsset, kind: MemoryMediaKind) => {
      const persisted = await persistPickedAsset(asset, kind);
      setAttachments((current) => [...current, persisted]);
    },
    [],
  );

  const capture = useCallback(
    async (kind: "image" | "video") => {
      try {
        setIsPicking(true);
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          Alert.alert("Camera permission", "Camera access is needed first.");
          return;
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
          await addPickedAsset(result.assets[0], kind);
        }
      } catch (error) {
        Alert.alert("Capture failed", getErrorMessage(error));
      } finally {
        setIsPicking(false);
      }
    },
    [addPickedAsset],
  );

  const pickFromLibrary = useCallback(async () => {
    try {
      setIsPicking(true);
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Photo permission", "Library access is needed first.");
        return;
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
      }
    } catch (error) {
      Alert.alert("Picker failed", getErrorMessage(error));
    } finally {
      setIsPicking(false);
    }
  }, []);

  const toggleRecording = useCallback(async () => {
    try {
      const status = await AudioModule.requestRecordingPermissionsAsync();
      if (!status.granted) {
        Alert.alert("Microphone permission", "Microphone access is needed.");
        return;
      }
      if (recorderState.isRecording) {
        await audioRecorder.stop();
        const recordingUri = audioRecorder.uri;
        if (!recordingUri) {
          return;
        }
        setAttachments((current) => [
          ...current,
          {
            id: `media_${Date.now().toString(36)}`,
            kind: "audio",
            uri: recordingUri,
            durationMs: recorderState.durationMillis ?? 0,
            mimeType: "audio/m4a",
            fileName: `voice-${Date.now()}.m4a`,
          },
        ]);
        return;
      }
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
    removeAttachment,
    reset,
    setBody,
    toggleRecording,
  };
}
