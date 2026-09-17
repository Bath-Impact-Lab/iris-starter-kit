import { afterEach, describe, expect, it, vi } from 'vitest'
import { CORE_AVIO_CHUNK_BYTES, createAccessUnitAssembler, createVideoFrameParser, IPC_FRAME_HEADER_SIZE, IPC_FRAME_MAGIC, type VideoAccessUnit, type VideoFrameChunk } from './videoPipeReader.js'

function buildFrame(cameraId: number, payload: Buffer): Buffer {
  const header = Buffer.alloc(IPC_FRAME_HEADER_SIZE)
  header.writeUInt32LE(IPC_FRAME_MAGIC, 0)
  header.writeUInt32LE(cameraId, 4)
  header.writeBigUInt64LE(1n, 8)
  header.writeBigUInt64LE(1000n, 16)
  header.writeUInt32LE(1920, 24)
  header.writeUInt32LE(1080, 28)
  header.writeUInt32LE(0, 32)
  header.writeUInt32LE(payload.length, 36)
  return Buffer.concat([header, payload])
}

describe('createVideoFrameParser', () => {
  it('parses a complete frame delivered in one chunk', () => {
    const chunks: VideoFrameChunk[] = []
    const push = createVideoFrameParser((chunk) => chunks.push(chunk))
    const payload = Buffer.from('mpeg-ts-bytes')

    push(buildFrame(0, payload))

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.cameraId).toBe(0)
    expect(chunks[0]?.payload.equals(payload)).toBe(true)
  })

  it('reassembles a frame split across multiple chunks', () => {
    const chunks: VideoFrameChunk[] = []
    const push = createVideoFrameParser((chunk) => chunks.push(chunk))
    const frame = buildFrame(2, Buffer.from('split-payload-bytes'))

    push(frame.subarray(0, 10))
    push(frame.subarray(10, IPC_FRAME_HEADER_SIZE + 5))
    push(frame.subarray(IPC_FRAME_HEADER_SIZE + 5))

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.cameraId).toBe(2)
    expect(chunks[0]?.payload.equals(Buffer.from('split-payload-bytes'))).toBe(true)
  })

  it('parses consecutive frames back to back', () => {
    const chunks: VideoFrameChunk[] = []
    const push = createVideoFrameParser((chunk) => chunks.push(chunk))

    push(Buffer.concat([buildFrame(0, Buffer.from('first')), buildFrame(1, Buffer.from('second'))]))

    expect(chunks).toHaveLength(2)
    expect(chunks[0]?.payload.toString()).toBe('first')
    expect(chunks[1]?.cameraId).toBe(1)
    expect(chunks[1]?.payload.toString()).toBe('second')
  })

  it('resynchronizes on the next magic after corrupted bytes', () => {
    const chunks: VideoFrameChunk[] = []
    const push = createVideoFrameParser((chunk) => chunks.push(chunk))
    const garbage = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00])

    push(Buffer.concat([garbage, buildFrame(3, Buffer.from('recovered'))]))

    expect(chunks).toHaveLength(1)
    expect(chunks[0]?.cameraId).toBe(3)
    expect(chunks[0]?.payload.toString()).toBe('recovered')
  })
})

function chunkOf(payload: Buffer, timestampMs = 1000n): VideoFrameChunk {
  return { cameraId: 1, frameIndex: 0n, timestampMs, width: 1920, height: 1080, payload }
}

describe('createAccessUnitAssembler', () => {
  afterEach(() => vi.useRealTimers())

  it('emits a chunk shorter than the Core AVIO buffer as a whole access unit', () => {
    const units: VideoAccessUnit[] = []
    const assembler = createAccessUnitAssembler((unit) => units.push(unit))

    assembler.push(chunkOf(Buffer.from('small-frame')))

    expect(units).toHaveLength(1)
    expect(units[0]?.data.toString()).toBe('small-frame')
  })

  it('joins full AVIO chunks with the shorter tail that ends the packet', () => {
    const units: VideoAccessUnit[] = []
    const assembler = createAccessUnitAssembler((unit) => units.push(unit))
    const full = Buffer.alloc(CORE_AVIO_CHUNK_BYTES, 1)

    assembler.push(chunkOf(full))
    assembler.push(chunkOf(full))
    expect(units).toHaveLength(0)
    assembler.push(chunkOf(Buffer.from([2, 2, 2])))

    expect(units).toHaveLength(1)
    expect(units[0]?.data.length).toBe(2 * CORE_AVIO_CHUNK_BYTES + 3)
  })

  it('flushes a packet that is an exact multiple of the AVIO buffer once the pipe goes idle', () => {
    vi.useFakeTimers()
    const units: VideoAccessUnit[] = []
    const assembler = createAccessUnitAssembler((unit) => units.push(unit), 5)

    assembler.push(chunkOf(Buffer.alloc(CORE_AVIO_CHUNK_BYTES)))
    vi.advanceTimersByTime(4)
    expect(units).toHaveLength(0)
    vi.advanceTimersByTime(1)

    expect(units).toHaveLength(1)
    expect(units[0]?.data.length).toBe(CORE_AVIO_CHUNK_BYTES)
  })

  it('drops a partial access unit on discard', () => {
    vi.useFakeTimers()
    const units: VideoAccessUnit[] = []
    const assembler = createAccessUnitAssembler((unit) => units.push(unit), 5)

    assembler.push(chunkOf(Buffer.alloc(CORE_AVIO_CHUNK_BYTES)))
    assembler.discard()
    vi.advanceTimersByTime(10)

    expect(units).toHaveLength(0)
  })
})
