import { afterEach, describe, expect, it } from 'vitest'
import { WebSocket } from 'ws'
import { VideoRelayServer } from './videoRelayServer.js'

const START = [0, 0, 0, 1]
const keyframe = (id: number) => Buffer.from([...START, 0x67, 0x64, 0x00, 0x1f, ...START, 0x68, 0xee, ...START, 0x65, id])
const delta = (id: number) => Buffer.from([...START, 0x41, id])

let relay: VideoRelayServer

afterEach(async () => {
  await relay?.stop()
})

function connect(url: string, headers?: Record<string, string>): Promise<{ socket: WebSocket; messages: Buffer[] }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers })
    const messages: Buffer[] = []
    socket.on('message', (data) => messages.push(data as Buffer))
    socket.once('open', () => resolve({ socket, messages }))
    socket.once('error', reject)
  })
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50))
}

describe('VideoRelayServer', () => {
  it('rejects connections without the stream token or from a foreign origin', async () => {
    relay = new VideoRelayServer()
    const [stream] = await relay.start([0])
    const withoutToken = stream!.url.replace(/\?token=.*/, '')

    await expect(connect(withoutToken)).rejects.toThrow()
    await expect(connect(stream!.url, { Origin: 'https://example.com' })).rejects.toThrow()
    const { socket } = await connect(stream!.url, { Origin: 'http://127.0.0.1:5173' })
    socket.close()
  })

  it('replays from the latest keyframe to a client that connects late', async () => {
    relay = new VideoRelayServer()
    const [stream] = await relay.start([0])
    relay.push(0, keyframe(1))
    relay.push(0, delta(2))
    relay.push(0, keyframe(3))
    relay.push(0, delta(4))

    const { socket, messages } = await connect(stream!.url)
    await settle()

    expect(messages.map((message) => message.at(-1))).toEqual([3, 4])
    socket.close()
  })

  it('waits for a keyframe before sending to a client that joined with nothing to replay', async () => {
    relay = new VideoRelayServer()
    const [stream] = await relay.start([0])
    const { socket, messages } = await connect(stream!.url)
    await settle()

    relay.push(0, delta(1))
    relay.push(0, keyframe(2))
    relay.push(0, delta(3))
    await settle()

    expect(messages.map((message) => message.at(-1))).toEqual([2, 3])
    socket.close()
  })
})
