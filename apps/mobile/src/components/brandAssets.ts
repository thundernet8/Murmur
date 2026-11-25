import Constants from "expo-constants";

const appVariant = Constants.expoConfig?.extra?.appVariant;

export const MURMUR_BRAND_MARK_SOURCE =
  appVariant === "development"
    ? require("../../../../assets/murmur/dev/icon-ios.png")
    : appVariant === "preview"
      ? require("../../../../assets/murmur/nightly/icon-ios.png")
      : require("../../../../assets/murmur/prod/icon-ios.png");
