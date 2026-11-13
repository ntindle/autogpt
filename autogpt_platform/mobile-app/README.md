# AutoGPT mobile app (proof of concept)

An Expo Router app for iOS and Android that talks to the same web app and backend as the site.

## Personal fork

This branch imports upstream PR #16715 at `9d163c1b72bf1ee4fe9d5042f1dde0257e627636`.
The installed app is **Otto Personal**, with iOS bundle ID and Android package
`com.ntindle.autogpt.personal`, URL scheme `ntindle-autogpt`, and a separate
SecureStore prefix. It can coexist with the work app.

Copy `.env.personal.example` to `.env.local` to connect to `tasks.ntindle.com`.
The server must run this branch's web auth changes with
`AUTH_MOBILE_APP_SCHEME=ntindle-autogpt`. The app first shows the existing
Cloudflare email-code sign-in and then the workspace's email/password sign-in.
The Access cookie is read through the native cookie store and sent only to the
configured frontend origin, including its `/_agpt` API path. No shared service
credential is embedded. The Cloudflare policy stays in place.

Build with `pnpm install --frozen-lockfile`, `pnpm exec expo prebuild --platform ios`,
then archive `ios/OttoPersonal.xcworkspace` in Xcode using your **personal** Apple
developer team. Select **OttoPersonal**, **Release**, and a generic iOS device.
Use a new build number for each TestFlight upload. Generated native projects and
signing credentials must stay untracked. Never change the bundle ID to the work
app's `co.agpt.autogpt.app` or reuse its distribution profile.

This mobile POC has no organization switcher. It uses the server's personal
workspace default; other organizations remain available through the web app.
It does not add native Tasks or OpenUI screens.

## What it does

- **Login:** email and password, existing accounts only.
- **Home:** the web's new-chat screen: "Hey, <name>", a sentence with an inline picker for who you are talking to (Otto or one of your experts), and a composer card. Under it, what needs you and what is running or next, when there is anything.
- **Chats:** the drawer lists one row per expert with their latest chat and has search; "All chats" lists every chat grouped by expert. In a chat you can send, stream, stop, load earlier messages, and pick up a reply that is still running or was dropped.
- **Chat feel:** a sent message moves to the top of the screen and the reply fills in below it at an even pace, without the view chasing it; an arrow brings you back to the end. The thread moves with the keyboard frame by frame, and dragging it down closes the keyboard. Long-press a message to copy or share it. On iOS 26 the composer is Liquid Glass.
- **Opening fast:** the app saves the chat list, your experts and your last few chats on the phone, so they open at once and then catch up with the server. A chat also starts loading as your finger lands on its row.
- **Steps:** what the expert is doing shows as a live list and folds to one line when the reply lands.
- **Attach and dictate:** in a chat, attach photos and files; anywhere the composer is, dictate into the field.
- **Chat panel:** in an expert's chat, their profile with Activity (upcoming routines, recent runs, computer state) and Library (files) tabs; in a chat with Otto, the chat's files. Share the chat from its top bar.
- **Team:** the experts you have hired; tap one to chat. Create a new expert from the header.
- **Settings:** the web `/settings` page in a WebView, reached from the user row at the foot of the drawer.
- **Themes:** light and dark, following the phone's setting.

## What it does not do

Sign-up, onboarding, billing and paywalls, social login, connecting integrations, push notifications, choosing a model, pausing a single routine, uploading or generating an expert's picture, deleting or downloading files, store builds, and CI.

## Run it

1. In `autogpt_platform/frontend/.env` set `AUTH_MOBILE_APP_SCHEME=ntindle-autogpt`, then run the frontend and backend as usual.
2. In this folder:

   ```sh
   pnpm install
   cp .env.example .env.local
   npx expo start
   ```

3. Press `i` for the iOS simulator or `a` for the Android emulator, or scan the QR code with Expo Go.

Expo Go sends an `exp://` origin, which the web app accepts only when it runs with `NODE_ENV=development` (`pnpm dev`). Against the docker compose frontend, sign-in from Expo Go fails.

`localhost` only works on the iOS simulator. On the Android emulator use `10.0.2.2` in `.env.local`; on a phone use your computer's address on the local network.

### How sign-in works on the server

With `AUTH_MOBILE_APP_SCHEME=ntindle-autogpt`, the web app's auth accepts a request whose `expo-origin` header is exactly `ntindle-autogpt://` (and, in development only, any `exp://` origin from Expo Go) as if it came from the site itself. The app scheme is never trusted as a redirect or callback URL, so the app sends no `callbackURL`. Without the variable, auth works as before.

## Environment

Set these in `.env.local` (see `.env.example`). Trailing slashes are dropped.

| Variable                   | Default                 | What it points at                                         |
| -------------------------- | ----------------------- | --------------------------------------------------------- |
| `EXPO_PUBLIC_FRONTEND_URL` | `http://localhost:3000` | The web app: sign-in (`/api/auth`) and the Settings page. |
| `EXPO_PUBLIC_API_URL`      | `http://localhost:8006` | The backend: chats and experts.                           |

## Scripts

- `pnpm start`: start the dev server.
- `pnpm test`: unit tests (jest-expo).
- `pnpm types`: type check.
- `pnpm lint`: lint.

## Known limits

- Saved chats sit unencrypted in the app's own storage (SQLite) for up to a day, at most eight of them; signing out deletes them.
- Dictation uses the web app's `/api/transcribe` route, so the web server needs a transcription key; without one the app says dictation isn't available.
- The microphone and photo permission texts in `app.json` only apply in a development or store build, not in Expo Go.
- The drawer shows each expert's latest chat title, not their last message: the session list has no preview field.
- A "Needs you" action that is not a chat or the team page opens on the web.
- Attaching a file with a name already used in the same chat fails; the backend refuses it.
- File chips under a sent message are kept only until the chat reloads from the server.
- Settings shows the web page's own navigation, and is always light.
- Credential and approval cards in a chat are not shown.
- Images in Otto's replies show as their alt text only.
- Only `http` and `https` links open.
- Plain HTTP only works in development; release builds need HTTPS.
- Settings uses native HttpOnly cookies. Signing out clears both native cookie stores, including the Cloudflare access session.
- The personal build uses a native cookie module and requires a compiled app; Expo Go cannot run it.
