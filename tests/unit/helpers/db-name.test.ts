import { describe, it, expect } from 'vitest';
import { databaseNameFromUrl, destructiveDbError } from '@/tests/helpers/db-name';

describe('databaseNameFromUrl', () => {
  it('reads the path segment before the query string of an SRV url', () => {
    expect(databaseNameFromUrl('mongodb+srv://u:p@c0.mongodb.net/signcraft?retryWrites=true&w=majority')).toBe(
      'signcraft'
    );
  });

  it('reads the database name without a query string', () => {
    expect(databaseNameFromUrl('mongodb://localhost:27017/signcraft_test')).toBe('signcraft_test');
  });

  it('is null when the url carries no database name', () => {
    expect(databaseNameFromUrl('mongodb://localhost:27017')).toBeNull();
    expect(databaseNameFromUrl('mongodb://localhost:27017/')).toBeNull();
    expect(databaseNameFromUrl('mongodb://localhost:27017/?replicaSet=rs0')).toBeNull();
  });

  it('is null for a missing url', () => {
    expect(databaseNameFromUrl(undefined)).toBeNull();
    expect(databaseNameFromUrl('')).toBeNull();
  });

  it('ignores a password containing an @ and a host list', () => {
    expect(databaseNameFromUrl('mongodb://user:p%40ss@a.example:27017,b.example:27017/signcraft_test?ssl=true')).toBe(
      'signcraft_test'
    );
  });
});

describe('destructiveDbError', () => {
  const prod = 'mongodb+srv://u:p@c0.mongodb.net/signcraft?retryWrites=true';
  const test = 'mongodb+srv://u:p@c0.mongodb.net/signcraft_test?retryWrites=true';

  it('allows a database whose name ends with _test', () => {
    expect(destructiveDbError(test, undefined)).toBeNull();
  });

  it('refuses a database whose name does not end with _test', () => {
    expect(destructiveDbError(prod, undefined)).toBe(
      'Refusing to wipe "signcraft" — point DATABASE_URL at a *_test database (see README › Tests)'
    );
  });

  it('refuses a url with no database name at all', () => {
    expect(destructiveDbError('mongodb://localhost:27017', undefined)).toContain('Refusing to wipe');
  });

  it('is overridable with ALLOW_DESTRUCTIVE_TESTS=1 and only that value', () => {
    expect(destructiveDbError(prod, '1')).toBeNull();
    expect(destructiveDbError(prod, 'true')).toContain('Refusing to wipe');
    expect(destructiveDbError(prod, '')).toContain('Refusing to wipe');
  });
});
