import type { CodegenConfig } from '@graphql-codegen/cli'

// Generated artifacts are committed; `npm run codegen:check` fails CI on drift. Enums are
// future-proofed and the cache gets generated possibleTypes: the server deploys new members
// only after clients parse them, so unknown values are expected input, never a crash.
const config: CodegenConfig = {
  schema: 'src/graphql/schema/*.graphqls',
  documents: 'src/**/*.graphql',
  generates: {
    'src/graphql/generated/': {
      preset: 'client',
      presetConfig: {
        fragmentMasking: false,
      },
      config: {
        strictScalars: true,
        scalars: {},
        enumsAsTypes: true,
        futureProofEnums: true,
        futureProofUnions: true,
        useTypeImports: true,
      },
    },
    'src/graphql/generated/possibleTypes.json': {
      plugins: ['fragment-matcher'],
      config: { apolloClientVersion: 3 },
    },
  },
}

export default config
