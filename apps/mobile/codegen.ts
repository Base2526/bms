import type { CodegenConfig } from '@graphql-codegen/cli';

const config: CodegenConfig = {
  schema: '../../schema.graphql',
  documents: ['src/graphql/**/*.graphql'],
  generates: {
    'src/graphql/generated.ts': {
      plugins: [
        { typescript: { typesPrefix: 'Schema' } },
        'typescript-operations',
        'typed-document-node',
      ],
      config: {
        avoidOptionals: true,
        enumsAsTypes: true,
        maybeValue: 'T | null',
        useTypeImports: true,
      },
    },
  },
};

export default config;
