import { Text, type TextProps } from "react-native";

import { useType, type TypeVariant } from "@/theme";

/**
 * The one text component screens use — variant from the named ramp,
 * never a raw fontSize (design-system skill). `selectable` is applied by
 * callers for data-bearing text.
 */
export function ThemedText({
  variant = "body",
  style,
  ...props
}: TextProps & { variant?: TypeVariant }) {
  const type = useType();
  return <Text style={[type[variant], style]} {...props} />;
}
