#!/usr/bin/env node
/**
 * AquaClaw build script
 * Copies source to dist/, makes CLI executable
 */
import { cpSync, mkdirSync, chmodSync } from 'fs';
import { join } from 'path';

console.log('Building AquaClaw...');

mkdirSync('dist', { recursive: true });
cpSync('src', 'dist/src', { recursive: true });
cpSync('packages', 'dist/packages', { recursive: true });

chmodSync('packages/cli/bin/aquaclaw.mjs', 0o755);
chmodSync('dist/packages/cli/bin/aquaclaw.mjs', 0o755);

console.log('✓ Build complete');
