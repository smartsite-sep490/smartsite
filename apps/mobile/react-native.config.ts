import path from 'node:path';

const picker = '@react-native-community/datetimepicker';
const pickerRoot = path.dirname(require.resolve(`${picker}/package.json`));

// Keep CMake's generated-source paths below Windows Ninja's 260-character limit.
// The app's pnpm symlink references the same files without the virtual-store prefix.
export default {
  dependencies:
    process.platform === 'win32'
      ? {
          [picker]: {
            platforms: {
              android: {
                cmakeListsPath: path.relative(
                  path.join(pickerRoot, 'android'),
                  path.join(
                    __dirname,
                    'node_modules',
                    picker,
                    'android/build/generated/source/codegen/jni/CMakeLists.txt',
                  ),
                ),
              },
            },
          },
        }
      : {},
};
