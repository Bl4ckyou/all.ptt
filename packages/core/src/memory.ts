export interface GgufModelInfo {
  size: number;
  blockCount: number | null;
  embeddingLength: number | null;
  headCount: number | null;
  headCountKv: number | null;
  contextLength: number | null;
}

export interface MemorySettings {
  gpuLayers?: number;
  contextSize?: number;
  cacheTypeKBytes?: number;
  cacheTypeVBytes?: number;
}

export interface MemoryEstimate {
  weightsBytes: number;
  kvCacheBytes: number;
  ramBytes: number;
  vramBytes: number;
  totalBytes: number;
  kvOnCpuBytes: number;
  kvOnGpuBytes: number;
}

const CACHE_TYPE_BYTES: Record<string, number> = {
  f32: 4,
  f16: 2,
  bf16: 2,
  q8_0: 34 / 32,
  q5_1: 24 / 32,
  q5_0: 22 / 32,
  q4_1: 20 / 32,
  q4_0: 18 / 32,
  iq4_nl: 18 / 32,
};

export function cacheTypeBytes(value: unknown): number {
  return typeof value === 'string' ? (CACHE_TYPE_BYTES[value] ?? 2) : 2;
}

function positive(value: number | undefined, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

// Estimate weights + KV cache split between system RAM and VRAM.
export function estimateMemory(info: GgufModelInfo, settings: MemorySettings): MemoryEstimate {
  const layers = positive(info.blockCount ?? undefined);
  const gpuLayers = positive(settings.gpuLayers ?? undefined);

  let gpuFraction = 0;
  if (layers > 0) gpuFraction = Math.min(gpuLayers / layers, 1);
  else if (gpuLayers > 0) gpuFraction = 1;

  const weights = info.size;
  const weightsOnGpu = weights * gpuFraction;
  const weightsOnCpu = weights - weightsOnGpu;

  const contextSize = positive(settings.contextSize ?? info.contextLength ?? undefined);
  const embedding = positive(info.embeddingLength ?? undefined);
  const heads = positive(info.headCount ?? undefined);
  const headsKv = positive(info.headCountKv ?? info.headCount ?? undefined);
  const headDim = heads > 0 ? embedding / heads : 0;

  const bytesK = settings.cacheTypeKBytes ?? 2;
  const bytesV = settings.cacheTypeVBytes ?? 2;
  const kvPerToken = headsKv * headDim * (bytesK + bytesV);
  const kvCache = layers * contextSize * kvPerToken;

  const kvOnGpu = kvCache * gpuFraction;
  const kvOnCpu = kvCache - kvOnGpu;

  const ramBytes = weightsOnCpu + kvOnCpu;
  const vramBytes = weightsOnGpu + kvOnGpu;

  return {
    weightsBytes: weights,
    kvCacheBytes: kvCache,
    ramBytes,
    vramBytes,
    totalBytes: ramBytes + vramBytes,
    kvOnCpuBytes: kvOnCpu,
    kvOnGpuBytes: kvOnGpu,
  };
}
