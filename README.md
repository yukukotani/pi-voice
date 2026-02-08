# pi-voice

## Setup

```bash
bun install
```

## CLI

pi-voice はバックグラウンド常駐型のアプリケーションです。ウィンドウを閉じてもプロセスは動き続け、Fn キーで録音できます。

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
- `status` はプロセスに接続せずファイルから状態を読むため軽量です。
- ウィンドウを閉じてもバックグラウンドで動作し続けます。完全に停止するには `stop` か Cmd+Q を使ってください。

### 開発モード

```bash
bun run dev
```

HMR 付きの Vite dev server で renderer を配信しつつ Electron を起動します。

開発時にサブコマンドを渡すには:

```bash
bun run dev -- -- status
```

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
