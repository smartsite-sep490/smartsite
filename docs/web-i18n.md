# Web UI: English and Vietnamese

The Web application supports English (`en`) and Vietnamese (`vi`). The flag menu is available in the application navbar and on the landing, login, registration, visitor and password setup screens. Switching updates the current UI, document language/title and display dates without signing out or resetting forms. The selection persists under `smartsite-language` in local storage. A first visit uses the browser language with English as the fallback.

This follows the i18next/react-i18next, JSON resources and flag dropdown approach in [SkillBridge's implementation](https://github.com/SkillBridgeExe/skillbridge-fe-official/blob/375dd8ce724ca3592410e996bf32a63ae9b2be88/src/i18n/index.ts) and [navbar](https://github.com/SkillBridgeExe/skillbridge-fe-official/blob/375dd8ce724ca3592410e996bf32a63ae9b2be88/src/components/layout/Navbar.tsx). The three runtime dependencies provide locale detection, interpolation/plurals, fallback resources and React subscriptions; existing Radix Popover provides the keyboard accessible menu. The flags are local SVGs with unique clip IDs.

## Resource and rendering conventions

- `apps/web/src/i18n/locales/{en,vi}.json` contains flat keys in the `common` namespace; dots are literal key characters. Keep both catalogs complete and interpolation variables identical.
- Translate whole sentences with named interpolation values. Use i18next `count` and `_one`/`_other` resources for counts; do not append English plural suffixes to translated nouns.
- React views subscribe with `useTranslation()`. Existing utilities call the stable `translate` function at render/use time. Do not add changing translation callbacks to network effects or command dependencies. Static shared labels use getters so they follow the current locale.
- `uiLocale()` supplies display locale; calendars also localize their navigation and date accessibility labels. Keep ISO date values, time zone calculations, API payloads, weekday numbers and authorization intervals invariant.
- `localizedLabel` translates known presentation metadata. Unknown machine codes remain visible. The translated caption never replaces a role, enum, query key or option value sent to the Backend.
- `localizeMessage` is restricted to system-owned notices, known errors and generated notification templates. It can re-render notices retained in state after a language change. Authored names, shift names, incident titles, notes/reasons, identifiers and raw audit JSON remain as recorded. Unknown English errors receive a localized generic retry message in Vietnamese.
- Keep the SmartSite wordmark, technical identifiers and language endonyms unchanged. Escape interpolated data through normal React rendering; do not insert translation results with `dangerouslySetInnerHTML`.

## Verification

```sh
pnpm --filter @smartsite/web test
pnpm --filter @smartsite/web test:i18n:browser
pnpm check
```

The source audit traverses every production TS/TSX file for missing literal translation keys, direct JSX text and visible string attributes. Catalog tests check parity, interpolation and encoded HTML entities. Locale tests cover keyboard switching, persistence, document metadata, interpolation safety, plurals, display dates and retained calendar values. Worker onboarding tests switch both directions with a filled form and verify unchanged Site/Contractor scope, requests and payload.

Browser QA visits the existing public/auth routes and all twelve application routes in both languages at 320, 390, 768, 1024 and 1440 px. It checks horizontal page overflow, clipped control/heading text, unresolved keys/placeholders and the wordmark. Screenshots are attached to the HTML report at `apps/web/playwright-report/index.html`; traces are retained on failure. Tables and known scroll areas may scroll locally. The test uses Chrome and synthetic API fixtures, with no production credentials, live camera or paid service. Browser fixtures include populated setup data and empty/denied API states; domain and populated workflow behavior remain covered by the Web component tests. This does not replace real device/camera validation or deploy a new runtime.

Layout adjustments let mobile headers/actions wrap, contain chart/table scrolling, constrain authentication panels and language menus, and keep long Vietnamese control labels within their containers. Add new visible text to both catalogs and run the checks above whenever a screen changes.

Verified on 2026-10-13: frozen install, peer checks, Mobile dependency checks and `pnpm check` passed. The Web suite passed all 448 tests. The full browser matrix passed 20/20 cases with no skipped or flaky cases; after the final auth spacing, password placeholder and mobile hero adjustments, all 10 public/auth language and viewport cases passed again. English/Vietnamese mobile and desktop screenshots were inspected. The final Web build passed and still reports a nonblocking bundle size warning (main JavaScript about 2.06 MB, 526 KB gzip).
