import { describe, expect, it } from 'vitest'
import { parsePipeData } from './pipeServer.js'

describe('parsePipeData', () => {
  it('parses complete newline-delimited frames', () => {
    expect(parsePipeData('{"frame":1}\n{"frame":2}\n')).toEqual({
      frames: [{ frame: 1 }, { frame: 2 }],
      remainder: '',
    })
  })

  it('keeps an incomplete frame for the next chunk', () => {
    expect(parsePipeData('{"frame":1}\n{"frame":')).toEqual({
      frames: [{ frame: 1 }],
      remainder: '{"frame":',
    })
  })

  it('skips malformed lines without stopping the stream', () => {
    expect(parsePipeData('not-json\n{"frame":2}\n')).toEqual({
      frames: [{ frame: 2 }],
      remainder: '',
    })
  })
})
