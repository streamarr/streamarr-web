import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const SHIPPED = 'public/licenses'

// Pinned so a changed text is a deliberate change, as the server pins its packaged license.
const PINNED: Record<string, string> = {
  'JetBrainsMono-OFL.txt': '30f0c136e3c88e422d0791acd97238870f9054a9729bc34cf2ff0d4ed8cac4ad',
  'SpaceGrotesk-OFL.txt': 'c6dec685825f73b18c20926fddc65e8315642e12986f15db0699170940a09efc',
  'lucide-ISC.txt': 'b495047bd93a9b06913511076f504daba17d5bbeb3e0650f3bb53a4220329c57',
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

describe('third-party notices', () => {
  it('shouldShipEveryLicenseTextTheNoticesNameAtItsPinnedBytes', () => {
    const notices = readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')
    const shipped = readdirSync(SHIPPED).sort()
    expect(shipped).toEqual(Object.keys(PINNED).sort())
    for (const file of shipped) {
      expect(notices).toContain(`${SHIPPED}/${file}`)
      expect(sha256(readFileSync(`${SHIPPED}/${file}`))).toBe(PINNED[file])
    }
  })

  it('shouldShipLucideLicenseByteIdenticalToThePinnedPackage', () => {
    expect(readFileSync(`${SHIPPED}/lucide-ISC.txt`)).toEqual(
      readFileSync('node_modules/lucide-react/LICENSE'),
    )
    const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { version: string }>
    }
    expect(readFileSync('THIRD_PARTY_NOTICES.md', 'utf8')).toContain(
      `lucide-react ${lock.packages['node_modules/lucide-react'].version}`,
    )
  })
})
