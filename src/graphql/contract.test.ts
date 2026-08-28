import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  buildSchema,
  concatAST,
  Kind,
  parse,
  validate,
  visit,
  type DocumentNode,
  type FieldNode,
} from 'graphql'
import { describe, expect, it } from 'vitest'

const root = join(__dirname, '..')
const schemaDirectory = join(__dirname, 'schema')
const schema = buildSchema(
  readdirSync(schemaDirectory)
    .filter((entry) => entry.endsWith('.graphqls'))
    .sort()
    .map((entry) => readFileSync(join(schemaDirectory, entry), 'utf8'))
    .join('\n'),
)

const documents = findDocuments(root).map((path) => ({
  path: path.slice(root.length + 1),
  document: parse(readFileSync(path, 'utf8')),
}))

describe('the pinned GraphQL contract', () => {
  it('has at least the known operations committed', () => {
    expect(documents.length).toBeGreaterThanOrEqual(2)
  })

  it.each(documents)('validates $path against the pinned schema', ({ path, document }) => {
    // graphql-codegen already treats every `.graphql` file under src/ as one combined document
    // set (documents: 'src/**/*.graphql' in codegen.ts), so a fragment defined in one file and
    // spread by an operation in another is a normal, supported shape here — merge with every
    // other file before validating, or a shared fragment file would always read as unused.
    const others = documents.filter((other) => other.path !== path).map((other) => other.document)
    expect(validate(schema, concatAST([document, ...others])).map(String)).toEqual([])
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
    } else if (entry.endsWith('.graphql')) {
      found.push(path)
    }
  }
  return found
}
