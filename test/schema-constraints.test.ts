import { expect, test } from 'vitest'
import {
  check,
  eq,
  foreignKey,
  index,
  integer,
  primaryKey,
  references,
  table,
  text,
  uniqueConstraint,
} from '../src/index.ts'
import { SchemaMetadataValidationError } from '../src/schema/metadata.ts'
import { validateConstraintDialect } from '../src/schema/constraints.ts'
import { validateIndexDialect } from '../src/schema/indexes.ts'

test('materializes relational IDs and physical names without changing legacy shape', () => {
  const accounts = table(
    'accounts',
    {
      id: integer(),
      code: text({ nullable: true }),
      displayName: text(),
    },
    accounts => ({
      constraints: {
        accountsPrimary: primaryKey(accounts.id, {
          physicalName: 'accounts_pk',
          deferrable: true,
          initially: 'deferred',
        }),
        accountsCodeUnique: uniqueConstraint(accounts.code, {
          nulls: 'distinct',
          physicalName: 'accounts_code_uq',
        }),
        accountsDisplayCheck: check(eq(accounts.displayName, 'accounts'), {
          physicalName: 'accounts_display_check',
        }),
      },
      indexes: {
        accountsCodeIndex: index([accounts.code], {
          physicalName: 'accounts_code_idx',
          include: [accounts.displayName],
        }),
      },
    })
  )

  const primary = accounts.constraints.accountsPrimary
  const nullableUnique = accounts.constraints.accountsCodeUnique
  const displayCheck = accounts.constraints.accountsDisplayCheck
  const codeIndex = accounts.indexes.accountsCodeIndex

  expect(primary).toMatchObject({
    kind: 'primary-key',
    columns: [accounts.id],
    deferrable: true,
    initially: 'deferred',
  })
  expect(nullableUnique).toMatchObject({
    kind: 'unique-constraint',
    columns: [accounts.code],
    nulls: 'distinct',
  })
  expect(displayCheck.physicalName).toBe('accounts_display_check')
  expect(primary.id).toBe('accountsPrimary')
  expect(primary.physicalName).toBe('accounts_pk')
  expect(nullableUnique.id).toBe('accountsCodeUnique')
  expect(nullableUnique.physicalName).toBe('accounts_code_uq')
  expect(codeIndex.id).toBe('accountsCodeIndex')
  expect(codeIndex.physicalName).toBe('accounts_code_idx')
  expect(codeIndex.includedColumns).toEqual([accounts.displayName])
  expect(Object.keys(primary)).toEqual([
    'kind',
    'columns',
    'deferrable',
    'initially',
  ])
  expect(Object.isFrozen(primary)).toBe(true)
  expect(Object.isFrozen(codeIndex.includedColumns)).toBe(true)
})

test('retains complete foreign-key options and validates target dialects', () => {
  const accounts = table('accounts', { id: integer() }, accounts => ({
    constraints: { accountsPrimary: primaryKey(accounts.id) },
    indexes: {},
  }))
  const memberships = table(
    'memberships',
    { accountId: integer() },
    memberships => ({
      constraints: {
        accountForeign: foreignKey(
          [memberships.accountId],
          references(accounts, accounts.id),
          {
            onUpdate: 'cascade',
            onDelete: 'set-null',
            match: 'full',
            deferrable: true,
            initially: 'deferred',
            physicalName: 'memberships_account_fk',
          }
        ),
      },
      indexes: {},
    })
  )

  const foreign = memberships.constraints.accountForeign
  expect(foreign).toMatchObject({
    kind: 'foreign-key',
    onUpdate: 'cascade',
    onDelete: 'set-null',
    match: 'full',
    deferrable: true,
    initially: 'deferred',
  })
  expect(foreign.physicalName).toBe('memberships_account_fk')

  const mysqlDiagnostics = validateConstraintDialect(foreign, 'mysql', [
    'tables',
    'memberships',
    'constraints',
    'accountForeign',
  ])
  expect(mysqlDiagnostics).toEqual([
    expect.objectContaining({
      code: 'unsupported-dialect-option',
      path: [
        'tables',
        'memberships',
        'constraints',
        'accountForeign',
        'deferrable',
      ],
    }),
  ])
})

test('reports duplicate physical names and unsupported included columns', () => {
  expect(() =>
    table('duplicate_names', { id: integer() }, duplicateNames => ({
      constraints: {
        first: primaryKey(duplicateNames.id, { physicalName: 'same_name' }),
        second: check(eq(duplicateNames.id, 1), {
          physicalName: 'same_name',
        }),
      },
      indexes: {},
    }))
  ).toThrow(SchemaMetadataValidationError)

  const records = table('records', {
    id: integer(),
    payload: text(),
  })
  const included = index([records.id], { include: [records.payload] })
  const diagnostics = validateIndexDialect(included, 'sqlite')
  expect(diagnostics).toEqual([
    expect.objectContaining({
      code: 'unsupported-dialect-option',
      path: ['index', 'includedColumns'],
      dialect: 'sqlite',
    }),
  ])
})
