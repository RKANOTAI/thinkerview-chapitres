import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm, type FileHandle } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'

import { parseSourceCatalog, type SourceCatalog } from '../src/domain/catalog'
import { fetchYouTubeCatalog } from './lib/youtube'

export const THINKERVIEW_CHANNEL_ID = 'UCQgWpmt02UtJkyO32HGUASQ'

export interface YouTubeSyncSummary {
  channelId: typeof THINKERVIEW_CHANNEL_ID
  playlistItems: number
  publicVideos: number
  unavailable: number
  changed: boolean
}

export interface SyncYouTubeOptions {
  apiKey: string
  outputPath: string
  now?: Date
  fetchImpl?: typeof fetch
}

export interface RunYouTubeSyncCliOptions {
  env?: NodeJS.ProcessEnv
  outputPath?: string
  now?: Date
  fetchImpl?: typeof fetch
  stdout?: (message: string) => void
  stderr?: (message: string) => void
}

async function readExistingCatalog(outputPath: string): Promise<SourceCatalog | null> {
  try {
    return parseSourceCatalog(JSON.parse(await readFile(outputPath, 'utf8')))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

function catalogContent(catalog: SourceCatalog): Omit<SourceCatalog, 'syncedAt'> {
  return {
    schemaVersion: catalog.schemaVersion,
    channel: catalog.channel,
    playlistItemCount: catalog.playlistItemCount,
    unavailableVideoIds: catalog.unavailableVideoIds,
    videos: catalog.videos,
  }
}

async function writeJsonAtomically(outputPath: string, value: unknown): Promise<void> {
  const outputDirectory = dirname(outputPath)
  await mkdir(outputDirectory, { recursive: true })
  const temporaryPath = join(
    outputDirectory,
    `.${basename(outputPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  let temporaryFile: FileHandle | undefined
  let temporaryFileCreated = false

  try {
    temporaryFile = await open(temporaryPath, 'wx', 0o600)
    temporaryFileCreated = true
    await temporaryFile.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await temporaryFile.close()
    temporaryFile = undefined
    await rename(temporaryPath, outputPath)
  } catch (error) {
    await temporaryFile?.close().catch(() => undefined)
    if (temporaryFileCreated) {
      await rm(temporaryPath, { force: true })
    }
    throw error
  }
}

export async function syncYouTube({
  apiKey,
  outputPath,
  now = new Date(),
  fetchImpl = fetch,
}: SyncYouTubeOptions): Promise<YouTubeSyncSummary> {
  const data = await fetchYouTubeCatalog({ apiKey, fetchImpl })
  if (data.channel.id !== THINKERVIEW_CHANNEL_ID) {
    throw new Error(`ID de chaîne YouTube inattendu: ${data.channel.id}`)
  }

  const candidate = parseSourceCatalog({
    schemaVersion: 1,
    ...data,
    syncedAt: now.toISOString(),
  })
  const previous = await readExistingCatalog(outputPath)
  const changed = previous === null
    || !isDeepStrictEqual(catalogContent(candidate), catalogContent(previous))
  const catalog = changed ? candidate : previous

  if (changed) {
    await writeJsonAtomically(outputPath, catalog)
  }

  return {
    channelId: THINKERVIEW_CHANNEL_ID,
    playlistItems: catalog.playlistItemCount,
    publicVideos: catalog.videos.length,
    unavailable: catalog.unavailableVideoIds.length,
    changed,
  }
}

export async function runYouTubeSyncCli({
  env = process.env,
  outputPath = resolve('data/youtube-videos.json'),
  now = new Date(),
  fetchImpl = fetch,
  stdout = (message) => process.stdout.write(message),
  stderr = (message) => process.stderr.write(message),
}: RunYouTubeSyncCliOptions = {}): Promise<number> {
  const apiKey = env.YOUTUBE_API_KEY?.trim()
  if (!apiKey) {
    stderr('YOUTUBE_API_KEY manquante\n')
    return 2
  }

  try {
    const summary = await syncYouTube({ apiKey, outputPath, now, fetchImpl })
    stdout(`${JSON.stringify(summary)}\n`)
    return 0
  } catch {
    stderr('Échec de la synchronisation YouTube\n')
    return 1
  }
}

function isMainModule(): boolean {
  const entryPath = process.argv[1]
  return entryPath !== undefined && import.meta.url === pathToFileURL(entryPath).href
}

if (isMainModule()) {
  process.exitCode = await runYouTubeSyncCli()
}
