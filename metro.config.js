const { getDefaultConfig } = require("@expo/metro-config");

module.exports = (async () => {
  const cfg = await getDefaultConfig(__dirname);

  // 👇 让 Metro 把 .bin 当 “静态资源” 打包进 APK / IPA
  cfg.resolver.assetExts.push("bin");

  return cfg;
})();