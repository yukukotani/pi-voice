# pi-voice

## Setup

```bash
bun install
bun run build
bun link          # `pi-voice` コマンドをグローバルに登録
```

## CLI

pi-voice はバックグラウンド常駐型のアプリケーションです。ウィンドウを閉じてもプロセスは動き続け、Fn キーで録音できます。

`status` / `stop` / `show` は Electron を起動せず即応します。

```bash
# 現在のディレクトリで pi-voice を起動（ウィンドウ表示）
pi-voice start

# 起動状態を確認（起動ディレクトリ・PID を表示）
pi-voice status

# ウィンドウを再表示
pi-voice show

# 停止（Fn キーも無効化）
pi-voice stop
```

- `start` は引数なしのデフォルトコマンドです。既に起動中ならエラーで終了します。
- `start` は事前に `bun run build` が必要です（`out/main/index.js` がなければエラー）。
- ウィンドウを閉じてもバックグラウンドで動作し続けます。完全に停止するには `stop` か Cmd+Q を使ってください。
- 実行状態は `~/.pi-voice/runtime-state.json` に保存されます。

### 開発モード

```bash
bun run dev
```

HMR 付きの Vite dev server で renderer を配信しつつ Electron を起動します（開発時はウィンドウを閉じると終了します）。

## Build

```bash
bun run build
```

`out/` にプロダクションビルドを出力します。

## Preview

```bash
bun run preview
```

ビルド済みの成果物で Electron を起動して動作確認します。

## Distribution

```bash
bun run dist
```

`bun run build` + electron-builder で macOS 向けの dmg/zip を `release/` に生成します。

パッケージングせずディレクトリ出力のみ（テスト用）:

```bash
bun run dist:dir
```
