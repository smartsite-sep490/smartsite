# Mobile native multipart uploads

Expo SDK 58 installs Expo fetch by default. Its multipart encoder reads Blob or
byte-readable file parts, while the old React Native URI-only part
`{ uri, name, type }` throws `Unsupported FormDataPart implementation` before
any HTTP request reaches Backend. The shared client classified that transport
exception as a network error, including immediately after selecting a citizen ID.

Mobile camera, gallery and document-picker selections now attach a lazy
`expo-file-system` File byte reader. Filename, media type and URI metadata remain
intact. The reader is non-enumerable: React Native's legacy `getParts()` and draft
fingerprints still receive the original metadata shape. Backend contracts,
authorization, multipart field names, size limits and validation are unchanged.
Missing/unreadable local files get a localized selection error before upload.

Regression tests exercise the installed Expo encoder through the shared client
for camera, gallery, PNG and PDF selection with synthetic bytes. The camera test
fails with the old URI-only implementation. No native build, database migration,
credential change or `EXPO_PUBLIC_USE_RN_FETCH` override is needed. Physical-device
acceptance must still be verified after reloading the updated JavaScript bundle.
