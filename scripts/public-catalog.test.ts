import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCatalog } from '../src/domain/catalog'

describe('published catalog', () => {
  it('contains every synchronized public video and validates at runtime', async () => {
    const content = await readFile(resolve('public/data/catalog.json'), 'utf8')
    const catalog = parseCatalog(JSON.parse(content))

    expect(catalog.videos.length).toBeGreaterThan(0)
    expect(catalog.videos.length + catalog.unavailableVideoIds.length)
      .toBe(catalog.playlistItemCount)
    expect(catalog.videos.some((video) => video.chapterStatus === 'ready')).toBe(true)
  })
})
