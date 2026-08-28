#!/usr/bin/env node
// Vendors the pinned streamarr-server schema into src/graphql/schema/: every .graphqls file under
// the server's schema directory, stored verbatim, plus a PROVENANCE note naming the source commit.
// The pin is exact — bumping it is a deliberate, reviewed change.
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fetchBytes, fetchJson, rawUrl, readPin, root } from './pin.mjs'

const pin = await readPin()
const target = join(root, 'src/graphql/schema')

const treeUrl = `https://api.github.com/repos/${pin.repository}/git/trees/${pin.commit}?recursive=1`
const tree = await fetchJson(treeUrl)
if (tree.truncated) {
  throw new Error(`Tree listing for ${pin.repository}@${pin.commit} was truncated; the schema would be incomplete`)
}
const files = tree.tree
  .filter(
    (entry) =>
      entry.type === 'blob' &&
      entry.path.startsWith(`${pin.schemaDirectory}/`) &&
      entry.path.endsWith('.graphqls'),
  )
  .map((entry) => entry.path)
  .sort()

if (files.length === 0) {
  throw new Error(`No schema files found under ${pin.schemaDirectory} at ${pin.commit}`)
}
if (new Set(files.map((path) => basename(path))).size !== files.length) {
  throw new Error(`Schema files under ${pin.schemaDirectory} share a name; they cannot be stored flat`)
}

// Start from an empty directory so files the server removed disappear here too.
await rm(target, { recursive: true, force: true })
await mkdir(target, { recursive: true })

for (const path of files) {
  await writeFile(join(target, basename(path)), await fetchBytes(rawUrl(pin, path)))
}

await writeFile(
  join(target, 'PROVENANCE'),
  `${pin.repository}@${pin.commit}\n${files.length} files from ${pin.schemaDirectory}\n`,
)
console.log(`Wrote ${files.length} files to src/graphql/schema/ from ${pin.repository}@${pin.commit}`)
