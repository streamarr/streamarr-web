import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildSchema,
  Kind,
  parse,
  validate,
  visit,
  type DocumentNode,
  type FieldNode,
} from 'graphql'
import { describe, expect, it } from 'vitest'

// The executable client contract: every committed document validates against the pinned server
// SDL, every mutation document changes exactly one thing, and every userErrors selection can
// render an unknown member through __typename plus the MutationError message fallback.

const root = join(__dirname, '..')
const schema = buildSchema(
  readFileSync(join(__dirname, 'schema.graphql'), 'utf8').replaceAll(/^# ---.*$/gm, ''),
)

const documents = findDocuments(root).map((path) => ({
  path: path.slice(root.length + 1),
  document: parse(readFileSync(path, 'utf8')),
}))

describe('the pinned GraphQL contract', () => {
  it('has at least the known operations committed', () => {
    expect(documents.length).toBeGreaterThanOrEqual(2)
  })

  it.each(documents)('validates $path against the pinned schema', ({ document }) => {
    expect(validate(schema, document).map(String)).toEqual([])
  })

  it.each(documents)('keeps $path to one root mutation field', ({ document }) => {
    for (const definition of document.definitions) {
      if (definition.kind !== Kind.OPERATION_DEFINITION || definition.operation !== 'mutation') {
        continue
      }
      const rootFields = definition.selectionSet.selections.filter(
        (selection) => selection.kind === Kind.FIELD,
      )
      expect(rootFields).toHaveLength(1)
    }
  })

  it.each(documents)('selects the unknown-member fallback in $path', ({ document }) => {
    for (const userErrors of userErrorSelections(document)) {
      const names = fieldNamesWithin(userErrors)
      expect(names).toContain('__typename')
      // message may ride an inline fragment on MutationError — a union exposes no fields.
      expect(names).toContain('message')
    }
  })
})

function fieldNamesWithin(field: FieldNode): string[] {
  const names: string[] = []
  visit(field, {
    Field(node) {
      if (node !== field) {
        names.push(node.name.value)
      }
    },
  })
  return names
}

function userErrorSelections(document: DocumentNode): FieldNode[] {
  const found: FieldNode[] = []
  visit(document, {
    Field(node) {
      if (node.name.value === 'userErrors') {
        found.push(node)
      }
    },
  })
  return found
}

function findDocuments(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry)
    if (statSync(path).isDirectory()) {
      if (entry !== 'generated' && entry !== 'node_modules') {
        found.push(...findDocuments(path))
      }
    } else if (entry.endsWith('.graphql') && entry !== 'schema.graphql') {
      found.push(path)
    }
  }
  return found
}
