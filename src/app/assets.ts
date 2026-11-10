import { AssetType, defineAssets } from "@iwsdk/core";

export default defineAssets({
  transport: {
    url: `${import.meta.env.BASE_URL}ui/transport.uikitml`,
    type: AssetType.UIKitML,
    name: "Transport",
  },
});
