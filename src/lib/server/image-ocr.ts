import "server-only";

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createWorker, OEM } from "tesseract.js";
import type { Worker } from "tesseract.js";

const OCR_LANGUAGES = ["chi_sim", "eng"] as const;
let workerPromise: Promise<Worker> | undefined;
let queuedRecognition: Promise<void> = Promise.resolve();

async function loadLanguage(code: (typeof OCR_LANGUAGES)[number]): Promise<{
  code: string;
  data: Buffer;
}> {
  const trainedDataPath = resolve(
    process.cwd(),
    "node_modules",
    "@tesseract.js-data",
    code,
    "4.0.0_best_int",
    `${code}.traineddata.gz`,
  );
  return { code, data: await readFile(trainedDataPath) };
}

async function createOcrWorker(): Promise<Worker> {
  const languages = await Promise.all(OCR_LANGUAGES.map(loadLanguage));
  return createWorker(languages, OEM.LSTM_ONLY, {
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

export async function recognizeImageText(image: Buffer): Promise<ImageOcrResult> {
  let releaseQueue = (): void => undefined;
  const previousRecognition = queuedRecognition;
  queuedRecognition = new Promise<void>((resolveQueue) => {
    releaseQueue = resolveQueue;
  });
  await previousRecognition;
  try {
    const worker = await getOcrWorker();
    const result = await worker.recognize(image);
    return {
      text: result.data.text.replace(/\r/g, "").trim(),
      confidence: result.data.confidence,
    };
  } catch (error) {
    await terminateOcrWorker();
    throw error;
  } finally {
    releaseQueue();
  }
}
