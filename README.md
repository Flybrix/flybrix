# Flybrix Studio

Unified successor to the legacy Flybrix Chrome App (desktop configuration
utility) and the Cordova mobile app: a single React + Vite codebase wrapped in
Tauri 2, with a swappable device-transport layer.

## Layout

- `packages/protocol` — `@flybrix/protocol`: TypeScript port of
  `flybrix-serialization` (schema-DSL binary serialization) plus the protocol
  descriptor files (`1.4`–`1.6`).
- `packages/core` — `@flybrix/core`: TypeScript port of the `flybrix-common`
  device-communication layer — COBS framing, message router, per-firmware
  version handler negotiation — de-Angularized (native Promises, no `$q`).
  Exports the `Transport` interface (the legacy `serial.Backend` contract).
- `apps/studio` — the Tauri 2 + React + Vite app. Desktop serial I/O is
  implemented in Rust (`src-tauri/src/serial.rs`, `serialport` crate) and
  exposed to the webview via `serial_*` commands; `src/transport/tauriSerial.ts`
  adapts it to the `Transport` interface. Mobile (Tauri iOS/Android) will get a
  BLE transport speaking the Nordic UART service, matching the legacy mobile
  app's GATT UUIDs.

## Develop

```sh
pnpm install
pnpm test                      # protocol + core test suites
cd apps/studio && pnpm tauri dev   # desktop app
```

The flight board is a Teensy 3.2 (USB VID 0x16C0); the legacy protocol is
COBS-framed binary messages with schema negotiation — see
`flybrix-common/descriptors/` in the legacy repos for the wire schemas.
