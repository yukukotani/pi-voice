/**
 * Whisper model manager.
 *
 * Resolves the path to a ggml Whisper model file. If WHISPER_MODEL_PATH is set
 * it is used directly. Otherwise the default model is auto-downloaded to
 * ~/.pi/whisper/ on first use with progress output to stderr.
 */

import { existsSync, mkdirSync, createWriteStream, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { Readable } from "node:stream";
import { finished } from "node:stream/promises";

const DEFAULT_MODEL = "medium-q5_0";
const HF_BASE_URL = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main";

/** Directory where auto-downloaded models are cached */
function modelCacheDir(): string {
  return join(homedir(), ".pi", "whisper");
}

function modelFileName(model: string): string {
  return `ggml-${model}.bin`;
}

/**
 * Download a Whisper model from HuggingFace with progress output.
 */
async function downloadModel(model: string, destPath: string): Promise<void> {
  const url = `${HF_BASE_URL}/${modelFileName(model)}`;
  console.log(`[Whisper] Downloading model "${model}" from ${url} ...`);

  const response = await fetch(url, { method: "GET", redirect: "follow" });

  if (!response.ok) {
    throw new Error(
      `Failed to download Whisper model "${model}": HTTP ${response.status}`,
    );
  }

  const totalBytes = Number(response.headers.get("content-length") ?? 0);
  const totalMB = totalBytes > 0 ? (totalBytes / 1024 / 1024).toFixed(0) : "?";

  // We write to a temp file first, then rename on success to avoid partial files
  const tmpPath = destPath + ".tmp";

  try {
    const fileStream = createWriteStream(tmpPath);
    let downloadedBytes = 0;
    let lastPercent = -1;

    const body = response.body;
    if (!body) {
      throw new Error("Response body is null");
    }

    // Wrap in a transform to track progress
    const reader = body.getReader();
    const progressStream = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        downloadedBytes += value.byteLength;
        const downloadedMB = (downloadedBytes / 1024 / 1024).toFixed(0);
        if (totalBytes > 0) {
          const percent = Math.floor(
            (downloadedBytes / totalBytes) * 100,
          );
          if (percent !== lastPercent) {
            lastPercent = percent;
            process.stderr.write(
              `\r[Whisper] Downloading model "${model}"... ${percent}% (${downloadedMB}/${totalMB} MB)`,
            );
          }
        } else {
          process.stderr.write(
            `\r[Whisper] Downloading model "${model}"... ${downloadedMB} MB`,
          );
        }
        controller.enqueue(value);
      },
    });

    await finished(
      Readable.fromWeb(progressStream as any).pipe(fileStream),
    );
    process.stderr.write("\n");

    // Rename temp to final
    const { renameSync } = await import("node:fs");
    renameSync(tmpPath, destPath);

    console.log(`[Whisper] Model saved to ${destPath}`);
  } catch (err) {
    // Clean up partial download
    try {
      unlinkSync(tmpPath);
    } catch {
      // ignore
    }
    throw err;
  }
}

/**
 * Resolve the path to a Whisper model file.
 *
 * 1. If `WHISPER_MODEL_PATH` is set, use it directly (error if missing).
 * 2. Otherwise, look for the default model in `~/.pi/whisper/`.
 *    If not present, download it automatically.
 */
export async function resolveModelPath(): Promise<string> {
  // Explicit override
  const envPath = process.env.WHISPER_MODEL_PATH;
  if (envPath) {
    if (!existsSync(envPath)) {
      throw new Error(
        `WHISPER_MODEL_PATH points to "${envPath}" but the file does not exist`,
      );
    }
    return envPath;
  }

  // Auto-download default model
  const model =
    process.env.WHISPER_MODEL ?? DEFAULT_MODEL;
  const cacheDir = modelCacheDir();
  const destPath = join(cacheDir, modelFileName(model));

  if (existsSync(destPath)) {
    return destPath;
  }

  // Ensure cache directory exists
  mkdirSync(cacheDir, { recursive: true });

  await downloadModel(model, destPath);
  return destPath;
}
