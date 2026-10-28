<p align="center">
  <img src="assets/icon-readme.png" width="84" alt="Viby" />
</p>

<h1 align="center">Viby</h1>

<p align="center">
  <strong>Music first. Everything else can wait.</strong><br />
  An ad-free, account-free desktop music player for macOS and Windows.
</p>

<p align="center">
  <a href="https://github.com/Rei-SU/Viby/releases/latest/download/Viby-macos-arm.dmg"><img alt="Download Viby for macOS on Apple silicon" src="https://img.shields.io/badge/macOS-Apple%20silicon-111111?style=flat-square&logo=apple&logoColor=white" /></a>
  <a href="https://github.com/Rei-SU/Viby/releases/latest/download/Viby-macos-intel.dmg"><img alt="Download Viby for macOS on Intel" src="https://img.shields.io/badge/macOS-Intel-111111?style=flat-square&logo=apple&logoColor=white" /></a>
  <a href="https://github.com/Rei-SU/Viby/releases/latest/download/Viby-windows-x64.exe"><img alt="Download Viby for Windows" src="https://img.shields.io/badge/Windows-x64-111111?style=flat-square&logo=windows&logoColor=white" /></a>
  <a href="https://github.com/Rei-SU/Viby/releases/latest"><img alt="Latest version" src="https://img.shields.io/github/v/release/Rei-SU/Viby?style=flat-square&color=111111&label=version" /></a>
  <a href="LICENSE"><img alt="License: Apache 2.0" src="https://img.shields.io/badge/license-Apache%202.0-111111?style=flat-square" /></a>
</p>

Viby opens on your music, not on an offer. No sign-up screen, no ad before the first song, no upsell sitting between you and play. Search for something, press play, and the app gets out of the way.

It plays from YouTube Music's catalogue, so almost anything you look for is there. The player, the library, the lyrics and the downloads are built here — which is why none of them are trying to sell you anything, and why what you keep stays on your machine.

<p align="center">
  <img src="docs/screenshots/home.png" alt="Viby home screen with this week's listening, recently played and quick picks" />
</p>
<p align="center">
  <sub>Home — what you played last, this week's listening, then something new.</sub>
</p>

## Get Viby

Download the latest release with the badges above: **Apple silicon** for an M-series Mac, **Intel** for an older one, **x64** for Windows 10 or 11. Every version and its notes are on the [releases page](https://github.com/Rei-SU/Viby/releases).

**macOS.** Drag Viby to Applications, then remove the download quarantine once:

```bash
xattr -dr com.apple.quarantine /Applications/Viby.app
```

The build is ad-hoc signed but not notarized. Gatekeeper may report it as damaged; that is Gatekeeper's decision, not a corrupt download. Viby checks for updates and opens the matching DMG, because an ad-hoc-signed app cannot replace itself in place.

**Windows.** The installer is per-user and needs no administrator password. Updates download, install in place and reopen Viby.

## What it does

- **A player that behaves.** Queue, shuffle, repeat, media keys, resume where you left off, and a cache that makes a replay instant. Quality is either best available or a 64 kbps data saver, and it is never silently downgraded.
- **A queue you can shape.** The queue docks beside the page: reorder it with the grip or the keyboard, or drag any song from search, an album or your history straight into it.
- **A home that remembers.** Recently played rows, the last 100 plays in a side panel, a weekly listening snapshot with your top artists, and mood pages that open YouTube Music's own Focus, Energize, Chill and Decades collections.
- **A library that stays yours.** Liked songs, playlists, saved albums and EPs, history and downloads live on your disk, fully usable signed out. No account, no cloud, no "syncing…" spinner.
- **Downloads that belong to the library.** Download songs, albums, playlists or Liked Songs; badges and progress rings show what is on disk. Viby follows your connection and can be switched offline by hand, with an Offline Home for what you kept.
- **Lyrics that keep up.** Time-synced lyrics from LRCLIB, plain text from lyrics.ovh as a backup, click any line to seek, and a docked panel that leaves the page usable.
- **Your music on Discord.** Friends see what's playing while the Discord desktop app is running. On by default; pausing clears it, and one switch in Settings turns it off.
- **Your playlists, not a fresh start.** Paste a public Spotify, Apple Music, Deezer, YouTube Music or SoundCloud playlist. Tracks are matched by title, artist and duration; anything uncertain is offered for review, never silently swapped.
- **Small things that add up.** Search from the titlebar (`⌘K` / `Ctrl K` or `/`), a full set of player shortcuts, launch at login with an optional minimized start, optional close-to-tray playback, Windows taskbar controls, and a What's New sheet after an update.
- **Quiet by design.** A monochrome interface, a slim icon rail, and a light footprint — under 400 MB at idle in our macOS tests.

## A closer look

<p align="center">
  <img src="docs/screenshots/search.png" width="49%" alt="Search results for Tame Impala with a top result, songs and artists" />
  <img src="docs/screenshots/artist.png" width="49%" alt="Tame Impala artist page with a banner, top songs and albums" />
</p>
<p align="center">
  <sub>Search across songs, albums, artists and playlists &nbsp;·&nbsp; Artist pages with real discographies</sub>
</p>

<p align="center">
  <img src="docs/screenshots/album.png" width="49%" alt="Currents album page with Save and Download actions and the real track list" />
  <img src="docs/screenshots/lyrics.png" width="49%" alt="Time-synced lyrics docked beside the Currents album page" />
</p>
<p align="center">
  <sub>Release pages with real track lists, artist and year &nbsp;·&nbsp; Lyrics docked beside the page — click a line to jump</sub>
</p>

## Where it stands

Viby is small on purpose and still early. The version badge at the top always shows the latest release; the [releases page](https://github.com/Rei-SU/Viby/releases) has the notes for each one.

- **macOS builds are ad-hoc signed and not notarized.** The first launch needs the `xattr` command above. Updates download the matching DMG; in-place macOS updates wait for Developer ID signing.
- **Windows updates install in place.** Windows 11 is verified on Electron 45. Windows 10 uses the same x64 build and is expected to behave the same; no separate hardware pass is planned.
- **No accounts, no sync, no telemetry.** Your liked songs, playlists, history and downloads are local files. Optional, end-to-end encrypted backup and sync is planned, and it will never be required to listen.

## What's next

- Manual search for import rows that don't match on their own, plus album and single links in the importer
- Drag-to-reorder playlists and virtualized lists for very long playlists
- Optional accounts: private, end-to-end encrypted backup and sync across devices

## Build from source

Requirements: **Node.js 22.12+** (required by Electron 45), npm, and the platform you are building for.

```bash
git clone https://github.com/Rei-SU/Viby.git
cd Viby
npm install
npm run runtime   # fetch the pinned playback runtime (once)
npm run dev
```

To build an installer:

```bash
npm run dist:mac   # macOS DMGs — Apple silicon + Intel
npm run dist:win   # Windows x64 installer
```

Packaged builds need no Python install, no configuration file and no first-run setup screen.

## Privacy

No account is required. No analytics, no telemetry, no ad tracking. Your library, playlists, history, downloads and cache live in your user data folder, and the app only talks to the network to browse and search the catalogue, play music, fetch lyrics and artist images, download music, import a link you paste, and check for updates. Discord presence (optional) sends the current song to the Discord app on your computer; Discord shows it according to your own Activity Privacy settings. If optional accounts ship later, they will only back up and sync your library; listening will never require one.

## Contributing

Viby is intentionally small and opinionated, and contributions are welcome.

- Open an issue before a large feature or refactor; small fixes can go straight to a PR.
- Keep PRs focused, match the existing Svelte/TypeScript style, and keep the UI monochrome.
- Run `npm run typecheck` and the suites in [TESTING.md](TESTING.md) for the files you changed.
- No ads, paywalls, tracking, telemetry or bundled credentials — ever. Accounts, when they ship, will exist only as an optional home for backup and sync.
- Don't commit `.env` files, cookies, downloaded audio or the vendored runtime.

The full rules live in [CONTRIBUTING.md](CONTRIBUTING.md). Be decent to each other.

## License

Apache-2.0 — see [LICENSE](LICENSE). The Viby name and logo are not covered by the license.

<p align="center"><sub>Built with Electron, Svelte and TypeScript. Lyrics by LRCLIB.<br />Viby is an independent project, not affiliated with any music service or rights holder.</sub></p>
