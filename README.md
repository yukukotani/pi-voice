# pi-voice

## Setup

```bash
bun install
bun run build
bun link          # `pi-voice` コマンドをグローバルに登録
```

## CLI

pi-voice は **daemon 型**のアプリケーションです。Docker と同じように、`start` でバックグラウンドに常駐し、CLI で操作します。起動時にウィンドウは表示されません。

`status` / `stop` / `show` は Electron を起動せず、Unix socket 経由で daemon と通信して即応します。

```bash
# daemon をバックグラウンドで起動（ウィンドウは表示されない）
pi-voice start

# daemon の状態を確認（state・PID・uptime を表示）
pi-voice status

# ウィンドウを表示
pi-voice show

# daemon を停止（ショートカットキーも無効化）
pi-voice stop
```

- `start` は引数なしのデフォルトコマンドです。既に起動中ならエラーで終了します。
- `start` は事前に `bun run build` が必要です（`out/main/index.js` がなければエラー）。
- 録音トリガーはデフォルトで `Cmd+Shift+I`（macOS）/ `Win+Shift+I`（Windows）の押下中です。キーバインドは `.pi/pi-voice.json` で変更できます（後述）。
- ウィンドウを閉じても daemon はバックグラウンドで動作し続けます。完全に停止するには `stop` か Cmd+Q を使ってください。
- 実行状態は `~/.pi-voice/runtime-state.json`、制御ソケットは `~/.pi-voice/daemon.sock`（macOS/Linux）または named pipe（Windows）に配置されます。

### キーバインド設定

`pi-voice start` を実行するディレクトリ（`cwd`）に `.pi/pi-voice.json` を配置すると、push-to-talk のキーバインドを変更できます。

```json
{
  "key": "ctrl+t"
}
```

`key` には `ctrl`, `shift`, `alt`/`opt`, `meta`/`cmd` の修飾キーと、メインキー（`a`-`z`, `0`-`9`, `f1`-`f12`, `space`, `escape` など）を `+` で繋いで指定します。

設定例:
- `"ctrl+t"` — Ctrl+T
- `"meta+shift+i"` — Cmd+Shift+I（デフォルト）
- `"alt+space"` — Alt+Space
- `"ctrl+shift+r"` — Ctrl+Shift+R

設定ファイルがない場合は `meta+shift+i` が使用されます。

### 開発モード

```bash
bun run dev:electron
```

HMR 付きの Vite dev server で renderer を配信しつつ Electron を起動します（開発時はウィンドウを閉じると終了します）。

CLI 単体で実行する場合:

```bash
bun run dev:cli
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
