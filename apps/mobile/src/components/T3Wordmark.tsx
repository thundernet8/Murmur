import type { ColorValue } from "react-native";
import Svg, { Image } from "react-native-svg";

export function T3Wordmark(props: {
  readonly height: number;
  readonly color?: ColorValue;
  readonly colorClassName?: string;
}) {
  return (
    <Svg
      accessibilityLabel="Murmur"
      height={props.height}
      width={props.height}
      viewBox="0 0 1024 1024"
    >
      <Image href={require("../../assets/murmur-mark.png")} width={1024} height={1024} />
    </Svg>
  );
}
