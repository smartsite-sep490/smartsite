import configPlugins from 'expo/config-plugins';
const { withProjectBuildGradle } = configPlugins;

// pnpm's virtual-store paths exceed CMake/Ninja's Windows object-path limit.
// Keep generated native staging files beside the app, outside node_modules.
export default function withWindowsNativeBuild(config) {
  return withProjectBuildGradle(config, (mod) => {
    const marker = '// @smartsite/windows-native-staging';
    if (!mod.modResults.contents.includes(marker)) {
      mod.modResults.contents += `\n${marker}
if (System.getProperty('os.name').toLowerCase().contains('windows')) {
  subprojects { nativeProject ->
    nativeProject.plugins.withId('com.android.library') {
      nativeProject.extensions.getByName('androidComponents').finalizeDsl { androidDsl ->
        androidDsl.externalNativeBuild.cmake.buildStagingDirectory = new File(rootProject.projectDir, ".native-cxx/" + nativeProject.name)
      }
    }
  }
}
`;
    }
    return mod;
  });
}
