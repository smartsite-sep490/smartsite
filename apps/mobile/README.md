# SmartSite mobile

Minimal Expo Router application using TanStack Query and `@smartsite/api-client` to call `GET /api/v1/health/live`. It shows configuration, loading, success, error, and retry states. This foundation does not implement login, camera capture, incident workflows, or inference.

## Local setup

Use Node 24 LTS and the root-pinned pnpm version. From the repository root:

```sh
pnpm install --frozen-lockfile
```

Copy `apps/mobile/.env.example` to `apps/mobile/.env.local`, then set `EXPO_PUBLIC_API_URL` for the target device:

| Target                            | API URL                                     |
| --------------------------------- | ------------------------------------------- |
| iOS simulator on the backend host | `http://localhost:3000`                     |
| Standard Android Studio emulator  | `http://10.0.2.2:3000`                      |
| Physical Android/iOS device       | `http://<development-computer-LAN-IP>:3000` |

Use the backend's base URL without `/api/v1/health/live`; the shared client appends the path. A physical phone's `localhost` points to the phone itself. For a phone, both devices must share a reachable network, the backend must listen on the LAN interface, and the host firewall must permit the development connection. Docker Compose binds the backend to loopback by default; use the host-run backend for LAN testing or deliberately configure a development-only LAN binding.

Start the backend from a separate terminal:

```sh
pnpm dev:api
```

The app uses a development build. For the first Android build, install Android Studio, its SDK and emulator, and the compatible JDK described in the [Expo local development guide](https://docs.expo.dev/guides/local-app-development/), then run from the repository root:

```sh
pnpm --filter @smartsite/mobile android
```

On macOS with Xcode installed, build the iOS simulator app:

```sh
pnpm --filter @smartsite/mobile ios
```

These commands generate ignored native projects and compile locally. After the development app is installed, start only Metro for subsequent JavaScript changes:

```sh
pnpm dev:mobile
```

Select the running emulator/simulator in Expo's terminal UI, or open the development build on a physical device and connect to Metro. For a local device build, use `pnpm --filter @smartsite/mobile exec expo run:android --device` or, on macOS, `pnpm --filter @smartsite/mobile exec expo run:ios --device`. iOS device installation also requires Apple signing setup. No EAS account or cloud build is required for emulator/simulator development.

Expo embeds `EXPO_PUBLIC_` values in JavaScript bundles. Keep credentials out of these values. Reload the app after changing `.env.local`; export again before distributing a bundle with a different API address. If a device's network policy rejects plain HTTP, use a reachable HTTPS development endpoint. Production APIs should use HTTPS. See [Expo environment variables](https://docs.expo.dev/guides/environment-variables/).

## Verification

Run from the repository root:

```sh
pnpm --filter @smartsite/mobile typecheck
pnpm --filter @smartsite/mobile check:dependencies
pnpm --filter @smartsite/mobile exec expo config --type public
pnpm --filter @smartsite/mobile build
```

`build` runs `expo export --platform all`. The app config enables only Android and iOS, so this writes both platforms' production JavaScript bundles and assets to `apps/mobile/dist`. This verifies bundling; it does not produce an APK, AAB, or IPA or prove device networking works. Native compilation and emulator/device smoke tests require the platform tools above. The web application lives in `apps/web`.

Expo SDK 57.0.23, Expo Router 57.0.21, React Native 0.86.3, and React 19.2.3 follow the stable Expo template matrix. Keep native package versions aligned with `expo install --check` when upgrading.
