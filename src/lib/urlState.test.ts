import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildPlayerUrl, parsePlayerUrl, replacePlayerUrl } from './urlState'

describe('parsePlayerUrl', () => {
  it('parses a video and its start time', () => {
    expect(parsePlayerUrl('?v=aaaaaaaaaaa&t=305')).toEqual({
      videoId: 'aaaaaaaaaaa',
      startSeconds: 305,
    })
  })

  it('drops a start time when no video is selected', () => {
    expect(parsePlayerUrl('?t=305')).toEqual({ videoId: null, startSeconds: 0 })
  })

  it.each([
    'short',
    'aaaaaaaaaaaa',
    'aaaaaaaaaa!',
  ])('rejects invalid video id %s and its time', (videoId) => {
    expect(parsePlayerUrl(`?v=${videoId}&t=305`)).toEqual({
      videoId: null,
      startSeconds: 0,
    })
  })

  it.each([
    '-1',
    '1.5',
    'Infinity',
    '9007199254740992',
  ])('rejects invalid start time %s', (startSeconds) => {
    expect(parsePlayerUrl(`?v=aaaaaaaaaaa&t=${startSeconds}`)).toEqual({
      videoId: 'aaaaaaaaaaa',
      startSeconds: 0,
    })
  })
})

describe('buildPlayerUrl', () => {
  it('preserves the GitHub Pages pathname while replacing query and hash', () => {
    const baseUrl = new URL('https://example.test/thinkerview-chapitres/?legacy=yes#ancien')

    const result = buildPlayerUrl(baseUrl, { videoId: 'aaaaaaaaaaa', startSeconds: 305 })

    expect(result).toBe('https://example.test/thinkerview-chapitres/?v=aaaaaaaaaaa&t=305')
    expect(baseUrl.href).toBe('https://example.test/thinkerview-chapitres/?legacy=yes#ancien')
  })

  it('does not serialize a start time without a video', () => {
    const baseUrl = new URL('https://example.test/thinkerview-chapitres/?legacy=yes#ancien')

    expect(buildPlayerUrl(baseUrl, { videoId: null, startSeconds: 305 }))
      .toBe('https://example.test/thinkerview-chapitres/')
  })

  it('does not serialize an invalid video id', () => {
    const baseUrl = new URL('https://example.test/thinkerview-chapitres/')

    expect(buildPlayerUrl(baseUrl, { videoId: 'short', startSeconds: 305 }))
      .toBe('https://example.test/thinkerview-chapitres/')
  })

  it.each([
    -1,
    1.5,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER + 1,
  ])('does not serialize invalid start time %s', (startSeconds) => {
    const baseUrl = new URL('https://example.test/thinkerview-chapitres/')

    expect(buildPlayerUrl(baseUrl, { videoId: 'aaaaaaaaaaa', startSeconds }))
      .toBe('https://example.test/thinkerview-chapitres/?v=aaaaaaaaaaa')
  })
})

describe('replacePlayerUrl', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('uses replaceState on the current page without navigating', () => {
    window.history.replaceState({ preserved: true }, '', '/thinkerview-chapitres/?legacy=yes#ancien')
    const replaceState = vi.spyOn(window.history, 'replaceState')

    replacePlayerUrl({ videoId: 'aaaaaaaaaaa', startSeconds: 305 })

    expect(replaceState).toHaveBeenCalledOnce()
    expect(replaceState).toHaveBeenCalledWith(
      { preserved: true },
      '',
      `${window.location.origin}/thinkerview-chapitres/?v=aaaaaaaaaaa&t=305`,
    )
    expect(window.location.pathname).toBe('/thinkerview-chapitres/')
    expect(window.location.search).toBe('?v=aaaaaaaaaaa&t=305')
    expect(window.location.hash).toBe('')
  })
})
