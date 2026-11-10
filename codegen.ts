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
    // The client types enums as unions, which list no values at run time. A screen that offers
    // every value of an enum, such as each Language, reads them from these constants.
    'src/graphql/generated/enumValues.ts': {
      plugins: ['typescript'],
      config: { onlyEnums: true, enumsAsConst: true, useTypeImports: true },
    },
    'src/graphql/generated/possibleTypes.json': {
      plugins: ['fragment-matcher'],
      config: { apolloClientVersion: 3 },
    },
  },
}

export default config
