/**
 * tests/helpers/env.ts — Vitest integration setup file: loads `.env` and
 * immediately guards the target database, before any test runs.
 */
import { config } from 'dotenv';
import { assertTestDatabase } from './db-name';

// dotenv never overrides an already-exported variable, so a DATABASE_URL set in
// the shell (the derived *_test string, see README › Tests) wins over `.env`.
config({ path: '.env' });

// Fail the whole integration run at setup rather than one test at a time if the
// suite is pointed at a database it would be wrong to wipe.
assertTestDatabase();
