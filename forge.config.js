const { FusesPlugin } = require('@electron-forge/plugin-fuses');
const { FuseV1Options, FuseVersion } = require('@electron/fuses');

module.exports = {
  packagerConfig: {
    asar: true,
    executableName: 'yanzhi-research-assistant',
    icon: './assets/icon',
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-squirrel',
      config: {},
    },
    {
      name: '@electron-forge/maker-dmg',
      platforms: ['darwin'],
      config: {
        format: 'ULFO',
      },
    },
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          name: 'yanzhi-research-assistant',
          productName: 'Yanzhi Research Assistant',
          maintainer: 'liyijia <1164763855@qq.com>',
          homepage: 'https://github.com/sanbuphy/yanzhi-ppocr',
          description: 'AI research assistant with local PaddleOCR.js OCR.',
          icon: './assets/icon.png',
          categories: ['Utility', 'Office'],
        },
      },
    },
    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          name: 'yanzhi-research-assistant',
          productName: 'Yanzhi Research Assistant',
          maintainer: 'liyijia <1164763855@qq.com>',
          homepage: 'https://github.com/sanbuphy/yanzhi-ppocr',
          description: 'AI research assistant with local PaddleOCR.js OCR.',
          icon: './assets/icon.png',
          categories: ['Utility', 'Office'],
        },
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};
