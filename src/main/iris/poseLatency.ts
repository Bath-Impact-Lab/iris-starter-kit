// Logs, every 10 s, how old each skeleton is when it reaches the kit and how
// many frames the monitor did not forward. slot_timestamp is IRIS's batch time
// on std::chrono::steady_clock, which on Windows is QueryPerformanceCounter in
// nanoseconds, the same clock process.hrtime reads, so the age is exact on the
// machine running IRIS. frame_seq numbers every batch IRIS publishes.
export class PoseLatencyMeter {
  private ages: number[] = []
  private skipped = 0
  private lastSeq: number | undefined
  private windowStart: bigint | undefined

  constructor(
    private readonly log: (line: string) => void,
    private readonly now: () => bigint = () => process.hrtime.bigint(),
    private readonly windowNs = 10_000_000_000n,
  ) {}

  observe(frame: unknown): void {
    if (!frame || typeof frame !== 'object') return
    const { slot_timestamp: slot, frame_seq: seq } = frame as { slot_timestamp?: unknown; frame_seq?: unknown }
    const now = this.now()
    if (typeof seq === 'number') {
      if (this.lastSeq !== undefined && seq > this.lastSeq + 1) this.skipped += seq - this.lastSeq - 1
      this.lastSeq = seq
    }
    if (typeof slot === 'number' && slot > 0) {
      const ageMs = Number(now - BigInt(Math.round(slot))) / 1e6
      // Anything outside 0-10 s is a clock mismatch, not a latency.
      if (ageMs >= 0 && ageMs < 10_000) this.ages.push(ageMs)
    }
    this.windowStart ??= now
    if (now - this.windowStart < this.windowNs) return
    this.report()
    this.windowStart = now
  }

  private report(): void {
    const sorted = [...this.ages].sort((a, b) => a - b)
    const pct = (q: number) => sorted[Math.floor(q * (sorted.length - 1))].toFixed(1)
    const age = sorted.length ? `${pct(0.5)}/${pct(0.95)} ms` : 'n/a (slot_timestamp missing or not on this clock)'
    this.log(`latency: skeleton age at kit (batch built -> received) p50/p95 ${age} over ${sorted.length} frames; ` +
      `${this.skipped} frames not forwarded by the monitor`)
    this.ages = []
    this.skipped = 0
  }
}
