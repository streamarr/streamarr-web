import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createServer, type Plugin } from 'vite'

/** An HTML page, which Vite completes like the app's own, or any other file. */
export type PageAnswer = { html: string } | { contentType: string; body: string | Uint8Array }

/** A Vite dev server for the app's source on the loopback address. */
export interface PageServer {
  /** The server's origin, such as http://127.0.0.1:5173. */
  origin: string
  close: () => Promise<void>
}

/**
 * Starts a Vite dev server for the app's source that answers each path in `answers` first, so a
 * recorder's page and its media share one origin with the modules the page imports. A request
 * path only looks an answer up; it never names a file to read.
 */
export async function servePages(answers: ReadonlyMap<string, PageAnswer>): Promise<PageServer> {
  const pages: Plugin = {
    name: 'recorder-pages',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const { pathname } = new URL(request.url ?? '/', 'http://localhost')
        // The answered path, not the request's, goes on: a request only picks among the answers.
        const path = [...answers.keys()].find((candidate) => candidate === pathname)
        const found = path === undefined ? undefined : answers.get(path)
        if (path === undefined || found === undefined) {
          next()
          return
        }
        if ('html' in found) {
          server.transformIndexHtml(path, found.html).then((html) => {
            response.setHeader('content-type', 'text/html')
            response.end(html)
          }, next)
          return
        }
        response.setHeader('content-type', found.contentType)
        response.end(found.body)
      })
    },
  }
  const server = await createServer({
    configFile: false,
    root: join(import.meta.dirname, '..'),
    logLevel: 'error',
    // Nothing may reload a page while a recorder uses it: no hot reload, and the one dependency
    // the pages import is bundled before the first page loads instead of when a page finds it.
    server: { host: '127.0.0.1', port: 0, hmr: false },
    optimizeDeps: { include: ['hls.js'], noDiscovery: true },
    plugins: [pages],
  })
  await server.listen()
  return {
    origin: server.resolvedUrls?.local[0]?.replace(/\/$/, '') ?? '',
    close: () => server.close(),
  }
}

/** An answer for each file in `directory`, at `servedPath` followed by the file's name. */
export async function fileAnswers(
  servedPath: string,
  directory: string,
): Promise<[string, PageAnswer][]> {
  const files = await readdir(directory)
  return Promise.all(
    files.map(async (file): Promise<[string, PageAnswer]> => [
      `${servedPath}/${file}`,
      {
        contentType: file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp4',
        body: await readFile(join(directory, file)),
      },
    ]),
  )
}
