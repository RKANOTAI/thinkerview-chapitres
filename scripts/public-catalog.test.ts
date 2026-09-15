import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseCatalog } from '../src/domain/catalog'

describe('published preview catalog', () => {
  it('is a valid empty catalog that activates the honest preview mode', async () => {
    const content = await readFile(resolve('public/data/catalog.json'), 'utf8')
    const catalog = parseCatalog(JSON.parse(content))

    expect(catalog.playlistItemCount).toBe(0)
    expect(catalog.unavailableVideoIds).toEqual([])
    expect(catalog.videos).toEqual([])
  })
})
