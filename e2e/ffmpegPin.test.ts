import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const WORKFLOW = '.github/workflows/ci.yml'

interface CustomManager {
  depNameTemplate?: string
  managerFilePatterns: string[]
  matchStrings: string[]
}

function ffmpegManager(): CustomManager | undefined {
  const renovate = JSON.parse(readFileSync('renovate.json', 'utf8')) as {
    customManagers?: CustomManager[]
  }
  return renovate.customManagers?.find(
    (manager) => manager.depNameTemplate === 'streamarr/streamarr-ffmpeg',
  )
}

// Renovate writes a file pattern as a regular expression between slashes.
function matchesFile(pattern: string, file: string): boolean {
  return new RegExp(pattern.slice(1, -1)).test(file)
}

describe('the FFmpeg pin in CI', () => {
  // Renovate skips a pin its rule no longer matches, and says nothing.
  it('shouldBeReadByRenovateAsOneReleaseWithItsChecksum', () => {
    const workflow = readFileSync(WORKFLOW, 'utf8')
    const release = /^ {2}FFMPEG_RELEASE: (\S+)$/m.exec(workflow)?.[1]
    const checksum = /^ {2}FFMPEG_SHA256: (\S+)$/m.exec(workflow)?.[1]

    const manager = ffmpegManager()
    const found = (manager?.matchStrings ?? []).flatMap((pattern) => [
      ...workflow.matchAll(new RegExp(pattern, 'g')),
    ])

    expect(manager?.managerFilePatterns.some((pattern) => matchesFile(pattern, WORKFLOW))).toBe(
      true,
    )
    expect(found.map((match) => match.groups)).toEqual([
      { currentValue: release, currentDigest: checksum },
    ])
  })
})
