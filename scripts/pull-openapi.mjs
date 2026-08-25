#!/usr/bin/env node
// Vendors the pinned streamarr-server OpenAPI document byte-for-byte into src/api/openapi.json.
// The pin is the same one the SDL uses: one server commit describes the whole contract.
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fetchBytes, rawUrl, readPin, root } from './pin.mjs'

const pin = await readPin()
if (!pin.openapiDocument) {
  throw new Error('src/graphql/schema.pin.json names no openapiDocument')
}
const target = join(root, 'src/api/openapi.json')

const bytes = await fetchBytes(rawUrl(pin, pin.openapiDocument))
await mkdir(dirname(target), { recursive: true })
await writeFile(target, bytes)
console.log(`Wrote src/api/openapi.json from ${pin.repository}@${pin.commit} (${pin.openapiDocument})`)
