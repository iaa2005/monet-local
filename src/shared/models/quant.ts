/**
 * GGUF's `general.file_type` enum, and how to say it out loud.
 *
 * The number is the quantisation the file was produced with. It is the
 * reliable answer — a filename can say anything — but it is also incomplete:
 * community re-quants (unsloth's `UD-IQ4_XS`, bartowski's `-imat` variants)
 * carry extra meaning the enum has no room for. So the library shows the
 * enum's name and keeps the filename's own suffix beside it when they
 * disagree.
 *
 * Values from ggml's `llama_ftype`. Gaps are deliberate: 4, 5 and 6 were
 * removed (Q4_1_SOME_F16 and the two Q4_2/Q4_3 that never shipped).
 */

export const FILE_TYPES: Record<number, string> = {
  0: 'F32',
  1: 'F16',
  2: 'Q4_0',
  3: 'Q4_1',
  7: 'Q8_0',
  8: 'Q5_0',
  9: 'Q5_1',
  10: 'Q2_K',
  11: 'Q3_K_S',
  12: 'Q3_K_M',
  13: 'Q3_K_L',
  14: 'Q4_K_S',
  15: 'Q4_K_M',
  16: 'Q5_K_S',
  17: 'Q5_K_M',
  18: 'Q6_K',
  19: 'IQ2_XXS',
  20: 'IQ2_XS',
  21: 'Q2_K_S',
  22: 'IQ3_XS',
  23: 'IQ3_XXS',
  24: 'IQ1_S',
  25: 'IQ4_NL',
  26: 'IQ3_S',
  27: 'IQ3_M',
  28: 'IQ2_S',
  29: 'IQ2_M',
  30: 'IQ4_XS',
  31: 'IQ1_M',
  32: 'BF16',
  33: 'Q4_0_4_4',
  34: 'Q4_0_4_8',
  35: 'Q4_0_8_8',
  36: 'TQ1_0',
  37: 'TQ2_0',
  38: 'MXFP4',
}

export function quantName(fileType: number | undefined): string {
  if (fileType === undefined) return 'unknown'
  return FILE_TYPES[fileType] ?? `ftype ${fileType}`
}

/**
 * The quantisation tag a filename advertises, if any.
 *
 * Matched from the END: `Qwen3.8-27B-UD-IQ4_XS.gguf` has `27B` in it, and a
 * greedy scan would report the parameter count as the quant.
 */
export function quantFromFilename(name: string): string | undefined {
  const stem = name.replace(/\.gguf$/i, '')
  const m = stem.match(
    /(?:^|[-_.])((?:UD-)?(?:IQ|Q)\d(?:_[A-Z0-9]+)*|BF16|F16|F32|MXFP4|TQ\d_\d)$/i,
  )
  return m?.[1]?.toUpperCase()
}
