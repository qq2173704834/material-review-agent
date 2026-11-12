import "server-only";

import { copyFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createWorker, OEM } from "tesseract.js";
import type { Worker } from "tesseract.js";

const OCR_LANGUAGES = ["chi_sim", "eng"] as const;
let workerPromise: Promise<Worker> | undefined;
let queuedRecognition: Promise<void> = Promise.resolve();
let pendingRecognitionCount = 0;

async function loadLanguage(
  code: (typeof OCR_LANGUAGES)[number],
  directory: string,
): Promise<void> {
  const trainedDataPath = resolve(
    process.cwd(),
    "node_modules",
    "@tesseract.js-data",
    code,
    "4.0.0_best_int",
    `${code}.traineddata.gz`,
  );
  await copyFile(trainedDataPath, resolve(directory, `${code}.traineddata.gz`));
}

async function createOcrWorker(): Promise<Worker> {
  const directory = resolve(
    process.env.REVIEW_DATA_DIR?.trim() || resolve(process.cwd(), ".local-data"),
    "ocr-languages",
  );
  await mkdir(directory, { recursive: true });
  await Promise.all(OCR_LANGUAGES.map((code) => loadLanguage(code, directory)));
  return createWorker([...OCR_LANGUAGES], OEM.LSTM_ONLY, {
    langPath: directory,
    cacheMethod: "none",
    logger: () => undefined,
  });
}

function getOcrWorker(): Promise<Worker> {
  workerPromise ??= createOcrWorker().catch((error: unknown) => {
    workerPromise = undefined;
    throw error;
  });
  return workerPromise;
}

async function terminateOcrWorker(): Promise<void> {
  const worker = workerPromise;
  workerPromise = undefined;
  if (!worker) return;
  try {
    await (await worker).terminate();
  } catch {
    /* A failed worker may already have terminated. */
  }
}

export interface ImageOcrResult {
  text: string;
  confidence: number;
}

export async function recognizeImageText(
  image: Buffer,
  timeoutMs = 30_000,
): Promise<ImageOcrResult> {
  if (pendingRecognitionCount >= 8) throw new Error("OCR 队列已满，请稍后重试。");
  pendingRecognitionCount++;
  const deadline = Date.now() + timeoutMs;
  let releaseQueue = (): void => undefined;
  const previousRecognition = queuedRecognition;
  queuedRecognition = new Promise<void>((resolveQueue) => {
    releaseQueue = resolveQueue;
  });
  await previousRecognition;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (Date.now() >= deadline) throw new Error("OCR 排队超时，请稍后重试。");
    const result = await Promise.race([
      (async () => {
        const worker = await getOcrWorker();
        return worker.recognize(image);
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("OCR 识别超时，请上传更清晰或更小的材料。")),
          deadline - Date.now(),
        );
      }),
    ]);
    return {
      text: result.data.text.replace(/\r/g, "").trim(),
      confidence: result.data.confidence,
    };
  } catch (error) {
    await terminateOcrWorker();
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    pendingRecognitionCount--;
    releaseQueue();
  }
}
