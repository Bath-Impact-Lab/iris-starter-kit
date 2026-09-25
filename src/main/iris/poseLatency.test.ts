import { describe, expect, it } from 'vitest'
import { PoseLatencyMeter } from './poseLatency.js'

// A clock in nanoseconds that the test moves by hand.
function fakeClock(startNs: bigint) {
  let t = startNs
  return { now: () => t, advanceMs: (ms: number) => { t += BigInt(Math.round(ms * 1e6)) } }
}

describe('PoseLatencyMeter', () => {
  it('reports skeleton age and frames the monitor skipped once per window', () => {
    const clock = fakeClock(5_000_000_000n)
    const lines: string[] = []
    const meter = new PoseLatencyMeter((line) => lines.push(line), clock.now, 1_000_000_000n)
    const start = 5_000_000_000
    // Frames 0..59 are published 16 ms apart and arrive 20 ms later; 1 in 3 is skipped.
    for (let seq = 0; seq < 60; seq++) {
      if (seq % 3 === 2) continue
      const published = start + seq * 16_000_000
      clock.advanceMs((published + 20_000_000 - Number(clock.now())) / 1e6)
      meter.observe({ frame_seq: seq, slot_timestamp: published })
    }
    expect(lines).toHaveLength(0)
    clock.advanceMs(1000)
    meter.observe({ frame_seq: 61, slot_timestamp: Number(clock.now()) - 20_000_000 })
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain('p50/p95 20.0/20.0 ms over 41 frames')
    expect(lines[0]).toContain('21 frames not forwarded')
  })

  it('ignores frames without a usable timestamp', () => {
    const clock = fakeClock(1_000_000_000n)
    const lines: string[] = []
    const meter = new PoseLatencyMeter((line) => lines.push(line), clock.now, 1n)
    meter.observe(null)
    meter.observe({ frame_seq: 1 })
    clock.advanceMs(1)
    meter.observe({ frame_seq: 2, slot_timestamp: 99e15 })
    expect(lines.at(-1)).toContain('n/a')
    expect(lines.at(-1)).toContain('0 frames not forwarded')
  })
})
