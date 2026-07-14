# Flybrix

Modernization monorepo for the Flybrix DIY drone. Consolidates the firmware,
the shared protocol libraries, and a single React + Vite + Tauri 2 app that
replaces both legacy front-ends (the desktop Chrome App and the Cordova mobile
app). The original repositories are archived as bare mirrors on the NAS; this
repo is a fresh start and does not carry their git history.

## Layout

- `firmware/` — flight-controller firmware for the Teensy 3.2 (MK20DX256),
  building on a modern toolchain via PlatformIO (`platformio.ini`, Teensyduino
  1.62 core). Snapshot of the modernized `flybrix-firmware`.
- `packages/protocol` — `@flybrix/protocol`: TypeScript port of
  `flybrix-serialization` (schema-DSL binary serialization) plus the protocol
  descriptor files (`1.4`–`1.6`).
- `packages/core` — `@flybrix/core`: TypeScript port of the `flybrix-common`
  device-communication layer — COBS framing, message router, per-firmware
  version handler negotiation — de-Angularized (native Promises, no `$q`).
  Exports the `Transport` interface (the legacy `serial.Backend` contract).
- `apps/studio` — the Tauri 2 + React + Vite app. Desktop USB serial I/O is
  implemented in Rust (`src-tauri/src/serial.rs`, `serialport` crate) and
  exposed to the webview via `serial_*` commands; `src/transport/tauriSerial.ts`
  adapts it to the `Transport` interface. A BLE transport (via `tauri-plugin-blec`
  / `btleplug`) is planned to cover desktop **and** mobile (iOS/Android),
  speaking the Nordic UART service — the same GATT UUIDs the legacy mobile app
  used.

## Transport matrix

| Platform | USB serial | BLE |
|---|---|---|
| Desktop (Win/macOS/Linux) | ✅ Rust `serialport` | ✅ planned (`blec`) |
| Android | — | ✅ planned (`blec`) |
| iOS | — (no MFi) | ✅ planned (`blec`) |

Firmware flashing is a desktop-USB-only capability. iOS/Android are BLE-only.

## Develop

```sh
pnpm install
pnpm test                 # protocol + core test suites
pnpm firmware:build       # PlatformIO firmware build (needs `pio` on PATH)
cd apps/studio && pnpm tauri dev   # desktop app
```

The flight board is a Teensy 3.2 (USB VID `0x16C0`); the wire protocol is
COBS-framed binary messages with schema negotiation — the authoritative
schemas ship in `packages/protocol/descriptors/`.
