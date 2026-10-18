# SmartSite mobile

Expo/React Native application for Workers and Contractor Representatives, using TanStack Query and the shared `@smartsite/api-client`. The application uses backend authentication and real workflows; it does not select roles from usernames or generate demo business data.

## Worker and Contractor workflows

After sign-in, choose an explicitly assigned role and Site. Representatives also choose an active Contractor scope. Changing scope unmounts drafts and aborts requests from the previous workspace. Accounts with multiple roles still see only the selected Worker/Contractor workspace; the Backend independently authorizes every request.

Workers can view their linked profile/team/Zone information, work schedules, attendance days and sessions, confirmed versus provisional hours, daily reports and CSV exports. They can submit and track attendance corrections, partial leave, overtime, full-shift absence, shift changes and swaps. Swap recipients confirm/decline before Contractor review. Opening QR on the home screen fetches the Worker's own QR and matching 8-character manual code without entering a Security session code. The code and QR share the same expiry and change together only when creating/refreshing the QR or changing direction; there is no timed code rotation. Mobile hides expired/failed codes. Security scans or types that code in its gate fallback flow; server authorization and passage confirmation still apply. See [Worker QR contract](../../contracts/worker-qr.md) and apply its Backend migration before using this flow. Workers can read, open or delete their own notifications. They cannot enroll or manage face profiles; enrollment is handled by an authorized Contractor Representative with the Worker's explicit consent, while Security verifies identity at the gate.

Representatives can view Contractor totals; create Worker accounts with server-generated codes and the existing initial-password policy; edit/suspend/restore Worker profiles; create/rename/archive teams; add/transfer/remove members; and assign/update/revoke team Zone permissions within existing Contractor grants. They can send Site/Zone assignment requests, grant/revoke Worker Zone permissions when the API allows, read schedules and attendance reports, and review shift changes/swaps without self-approval. Direct schedule configuration and attendance/leave/overtime approval remain Site Manager operations.

Assigned safety work includes starting checklists, answering every criterion, attaching JPEG/PNG/PDF evidence, submitting reports, reading returned/accepted submissions, and following linked incidents. Assigned corrective actions support start, result submission with an optional JPEG, protected evidence viewing and history. Representatives do not get the general Safety monitoring/review workspace.

Mobile has no Worker face enrollment or face-profile management screen for either role. Contractor Representatives use the existing Web enrollment workflow with the Worker's explicit consent. Web enrollment and Backend APIs remain available.

Worker account creation now collects citizen ID, gender, address, phone number, front/back ID images
and the three required safety/health/insurance documents. Every attachment supports camera, photo
library and existing file selection. Images must pass Backend quality checks before selection and
again before storage. A PDF may contain up to four pages, at most 5 MiB per file; citizen ID sides
require JPEG/PNG. Upload interruptions keep the newly created account so retry continues its files
instead of creating a second account. The Worker and Representative can open protected originals
from the document profile; Representatives can submit replacements. Safety Officers review on Web.
Newly uploaded documents never extend validity without a new Safety approval. All Workers,
including existing accounts, can view the Representative's optional manual date suggestion.
Health certificates use the examination/issue date, with expiry computed one calendar year
later (29 February becomes 28 February). Safety cards and insurance use an expiry date.
Representatives can correct the appropriate date while pending,
without uploading the original again. Manual dates still require Safety confirmation. All Workers,
including existing accounts, need three current approved documents for entry and Worker write
operations. Pending/expired profiles retain sign-in, reads and trusted exit operations. OCR compares
citizen IDs on images/certificates with the saved profile; mismatches are visible to the Worker,
Representative and Safety Officer but never block submission or approval.
Safety must approve the dates before renewal takes effect; existing approved health dates are
preserved until a new approval. See [Worker documents](../../contracts/worker-documents.md)
and apply its Backend migrations, including `WorkerHealthIssueDate1792800000000`.

Only refresh credentials are stored with [Expo SecureStore](https://docs.expo.dev/versions/v57.0.0/sdk/securestore/), separately for each API origin; access tokens remain in memory. Refresh rotation is serialized, authenticated 401s share one refresh, and logout clears local credentials even when the server is unavailable. Password changes revoke sessions and return to login. Private query data is cleared when the session changes. Camera/document/share functionality requires a rebuilt development client after installing the added native modules.

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

`pnpm dev:mobile` uses localhost, IPv4 resolution, port 8081 and two Metro workers. With the Android emulator running, press `a` in the Expo terminal; Expo sets up ADB port forwarding and opens the installed development app. This command does not compile or install an APK. For a physical phone on the same LAN, use `pnpm dev:mobile:lan` instead.

The equivalent explicit command for the existing Windows Android development client is:

```powershell
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:NODE_OPTIONS = "--dns-result-order=ipv4first"
pnpm --filter @smartsite/mobile exec expo start --dev-client --localhost --port 8081 --max-workers 2
```

With the emulator running, use another terminal to forward the Metro port, then press `a` in Expo's terminal:

```powershell
& "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe" reverse tcp:8081 tcp:8081
```

These commands reuse the installed development app. They do not run `expo run:android`, Gradle or prebuild. The backend and its development PostgreSQL database must also be running for sign-in and business operations.

Select the running emulator/simulator in Expo's terminal UI, or open the development build on a physical device and connect to Metro. For a local device build, use `pnpm --filter @smartsite/mobile exec expo run:android --device` or, on macOS, `pnpm --filter @smartsite/mobile exec expo run:ios --device`. iOS device installation also requires Apple signing setup. No EAS account or cloud build is required for emulator/simulator development.

Expo embeds `EXPO_PUBLIC_` values in JavaScript bundles. Keep credentials out of these values. Reload the app after changing `.env.local`; export again before distributing a bundle with a different API address. If a device's network policy rejects plain HTTP, use a reachable HTTPS development endpoint. Production APIs should use HTTPS. See [Expo environment variables](https://docs.expo.dev/guides/environment-variables/).

## Verification

Run from the repository root:

```sh
pnpm --filter @smartsite/mobile typecheck
pnpm --filter @smartsite/mobile test
pnpm --filter @smartsite/mobile check:dependencies
pnpm --filter @smartsite/mobile exec expo config --type public
pnpm --filter @smartsite/mobile build
```

`build` runs `expo export --platform all`. The app config enables only Android and iOS, so this writes both platforms' production JavaScript bundles and assets to `apps/mobile/dist`. This verifies bundling; it does not produce an APK, AAB, or IPA or prove device networking works. Native compilation and emulator/device smoke tests require the platform tools above. The web application lives in `apps/web`.

Mobile tests cover credential persistence/rotation/logout races, selected schedule and swap submission, role/scope restrictions, correct review dispatch and queue refresh, assigned-checklist submission and required evidence, notification targets, CSV safety, and complete pagination. Native UI, permissions, camera capture, file sharing and device networking still require an Android/iOS device smoke test; the React renderer tests do not emulate those native services.

Local verification on 2026-10-17: frozen installation, peer checks, Expo dependency compatibility, lint/typechecking, all 27 mobile tests and all 329 backend unit/HTTP tests passed. The web suite had one VisitorRegistration timeout during emulator startup; its isolated retry and the subsequent full run with two workers both passed (594/594). No additional build was run after removing Worker self-enrollment, as requested. The earlier Android `:app:assembleDebug -PreactNativeArchitectures=x86_64` succeeded with Android Studio's JBR 21 and the local Android SDK, producing `android/app/build/outputs/apk/debug/app-debug.apk`. The development APK was installed and opened on `emulator-5554`; Metro served the updated bundle and the SmartSite login controls were verified on the device. On this Windows host, Metro needed IPv4 (`NODE_OPTIONS=--dns-result-order=ipv4first`) with `adb reverse tcp:8081 tcp:8081`. Authenticated workflows, camera and sharing remain pending device checks. The Worker QR follow-up below adds PostgreSQL integration verification and local readiness; it does not replace a device gate test.

Worker QR follow-up on 2026-10-17: all 38 mobile tests, 73 API-client tests, 13 relevant web tests (including translations and Security manual code input), and the focused QR unit/PostgreSQL integration checks passed. API-client, Mobile, Web and Backend test-compilation type checks passed. QR changed-file lint and `git diff --check` passed. Whole-repository lint still reports 14 unrelated errors in the other mobile screens/icons/tests; the full `pnpm check` pipeline was not claimed. Migration `WorkerQrShortCodes1792454400000` was applied to local development PostgreSQL, and Backend readiness returned database up. No APK or Expo export was built. QR and its matching manual code now remain unchanged until explicit refresh/new QR creation or a direction change; expiry hides both. The large bottom Close button has been removed from the QR modal; the top X remains.
For Android Studio, generate the local project with `pnpm --filter @smartsite/mobile exec expo prebuild --platform android --no-install` and open `apps/mobile/android`. The generated Android/iOS projects are ignored by Git. Configure `ANDROID_HOME`/`ANDROID_SDK_ROOT` for your SDK and ensure the AVD's actual system image is installed; an `.avd` configuration alone is insufficient. A native compile can be checked with `android/gradlew.bat :app:assembleDebug -PreactNativeArchitectures=x86_64` on Windows, then use the normal `android` command to install/run on the emulator.

The local Expo config plugin places Windows library CMake staging directories under `android/.native-cxx/`. The React Native autolinking config also references the date/time picker's generated C++ through the app's shorter `node_modules` symlink. Together these avoid pnpm virtual-store paths exceeding CMake/Ninja object-path and source-path limits. The plugin uses Android Gradle's [buildStagingDirectory](https://developer.android.com/reference/tools/gradle-api/8.0/com/android/build/api/dsl/Cmake) setting; neither configuration modifies installed dependencies. Regenerate with prebuild after changing the plugin. If an existing generated project cached an older autolinking config, remove only `android/build/generated/autolinking/autolinking.json` before rebuilding.

The pinned SDK 57 compatibility set uses Expo 57.0.30, Expo Router 57.0.28, Expo Dev Client 57.0.20, Expo Splash Screen 57.0.10, React Native 0.86.3 and React 19.2.3. Keep native package versions aligned with `expo install --check` when upgrading.

The 2026-10-13 CI fix updates these four Expo patches and the lockfile. Exact-version release-age exceptions were approved for the 16 affected Expo packages while they are inside the one-day window; `pnpm-workspace.yaml` lists them individually and retains `minimumReleaseAge: 1440` for other packages. CI continues running the online Expo compatibility check. Rebuild an installed development client before validating the updated native packages on a device; JavaScript export alone does not verify a native build.

The 2026-10-16 CI fix aligns Expo 57.0.30, Expo Constants 57.0.22, Expo Linking 57.0.13 and Expo Router 57.0.28 with the online compatibility check. Six exact-version release-age exceptions were authorized for the required fresh Expo packages; other dependencies retain the 24-hour minimum release age. Rebuild development clients after this native dependency update.
