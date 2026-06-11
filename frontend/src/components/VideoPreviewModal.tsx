/**
 * VideoPreviewModal — inline video player for proof clips on seller returns.
 *
 * Uses `expo-video` (replaces deprecated `expo-av`). On native, the player
 * renders a native AVPlayer / ExoPlayer instance; on web it falls back to a
 * standard <video> element via the same component API.
 */
import { useVideoPlayer, VideoView } from "expo-video";
import { X } from "lucide-react-native";
import { useEffect } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { radius, spacing } from "@/src/lib/theme";

type Props = {
  visible: boolean;
  url: string | null;
  title?: string;
  onClose: () => void;
};

export function VideoPreviewModal({ visible, url, title, onClose }: Props) {
  const player = useVideoPlayer(url ?? "", (p) => {
    p.loop = false;
    p.muted = false;
  });

  // Autoplay when the modal opens; pause when it closes.
  useEffect(() => {
    if (!player) return;
    if (visible && url) {
      try { player.play(); } catch { /* noop */ }
    } else {
      try { player.pause(); } catch { /* noop */ }
    }
  }, [visible, url, player]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      onRequestClose={onClose}
      testID="video-preview-modal"
    >
      <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
        <View style={styles.header}>
          <Text style={styles.title} numberOfLines={1}>
            {title || "Proof video"}
          </Text>
          <Pressable
            testID="video-preview-close"
            onPress={onClose}
            hitSlop={12}
            style={styles.closeBtn}
          >
            <X size={22} color="#fff" />
          </Pressable>
        </View>

        <View style={styles.playerWrap}>
          {url ? (
            <VideoView
              player={player}
              style={styles.video}
              contentFit="contain"
              nativeControls
              allowsFullscreen
              allowsPictureInPicture={false}
            />
          ) : null}
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  title: { color: "#fff", fontSize: 15, fontWeight: "700", flex: 1, marginRight: spacing.md },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.15)",
    alignItems: "center",
    justifyContent: "center",
  },
  playerWrap: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radius.lg },
  video: { width: "100%", aspectRatio: 9 / 16, maxHeight: "100%", borderRadius: radius.lg },
});
