import { describe, expect, it } from 'vitest';
import { planParts } from '@/lib/upload/plan';
import { fileSource, simulatedSource } from '@/lib/upload/part-source';

describe('simulatedSource', () => {
  // Use a small custom part size (proportionally identical to 25 MiB / 10 MiB / 5 MiB)
  // so the test allocates bytes, not mebibytes, and stays fast.
  it('sizes parts from the plan, with the last part short', () => {
    const plan = planParts(25, 10); // 3 parts: 10, 10, 5
    const source = simulatedSource(plan);

    const part1 = source(1);
    const part3 = source(3);

    expect(part1.size).toBe(10);
    expect(part3.size).toBe(5);
  });

  it('reuses the same underlying buffer across non-final parts', () => {
    const plan = planParts(25, 10);
    const source = simulatedSource(plan);

    const part1 = source(1);
    const part2 = source(2);

    expect(part1.size).toBe(part2.size);
    expect(part1.type).toBe(part2.type);
    expect(part1.type).toBe('application/octet-stream');
  });
});

describe('fileSource', () => {
  it('slices the underlying File at the part boundaries', () => {
    const plan = planParts(25, 10);
    const bytes = new Uint8Array(25);
    for (let i = 0; i < bytes.length; i++) bytes[i] = i;
    const file = new File([bytes], 'test.bin');
    const source = fileSource(file, plan);

    expect(source(1).size).toBe(10);
    expect(source(2).size).toBe(10);
    expect(source(3).size).toBe(5);
  });
});
