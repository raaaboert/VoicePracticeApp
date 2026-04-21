import { View } from "react-native";

export const PERITIO_BRAND_COLORS = {
  ink: "#0F233A",
  paper: "#F4F0E6",
  sand: "#E8DDCB",
  brass: "#C9A46A",
  line: "rgba(15, 35, 58, 0.12)",
} as const;

export function PeritioBrandMark({
  size = 96,
  variant = "light",
}: {
  size?: number;
  variant?: "light" | "dark";
}) {
  const primary = variant === "dark" ? PERITIO_BRAND_COLORS.paper : PERITIO_BRAND_COLORS.ink;
  const accent = PERITIO_BRAND_COLORS.brass;
  const stemWidth = size * 0.16;
  const stemHeight = size * 0.64;
  const ringSize = size * 0.42;
  const ringStroke = Math.max(4, size * 0.075);

  return (
    <View
      style={{
        width: size,
        height: size,
        position: "relative",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          position: "absolute",
          left: size * 0.23,
          top: size * 0.18,
          width: stemWidth,
          height: stemHeight,
          borderRadius: stemWidth / 2,
          backgroundColor: primary,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.34,
          top: size * 0.18,
          width: ringSize,
          height: ringSize,
          borderRadius: ringSize / 2,
          borderWidth: ringStroke,
          borderColor: primary,
        }}
      />
      <View
        style={{
          position: "absolute",
          left: size * 0.46,
          top: size * 0.7,
          width: size * 0.2,
          height: size * 0.04,
          borderRadius: size * 0.02,
          backgroundColor: accent,
        }}
      />
    </View>
  );
}
