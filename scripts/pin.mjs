// The one pin for the server contract: an exact streamarr-server commit that names both the SDL
// directory and the OpenAPI document. GITHUB_TOKEN is optional and only lifts the rate limit.
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const root = join(dirname(fileURLToPath(import.meta.url)), '..')

export async function readPin() {
  return JSON.parse(await readFile(join(root, 'src/graphql/schema.pin.json'), 'utf8'))
}

export function rawUrl(pin, path) {
  return `https://raw.githubusercontent.com/${pin.repository}/${pin.commit}/${path}`
}

export async function fetchJson(url) {
  const response = await fetch(url, { headers: githubHeaders() })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return response.json()
}

export async function fetchBytes(url) {
  const response = await fetch(url, { headers: githubHeaders() })
  if (!response.ok) throw new Error(`${url} answered ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

function githubHeaders() {
  return process.env.GITHUB_TOKEN
    ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` }
    : {}
}
