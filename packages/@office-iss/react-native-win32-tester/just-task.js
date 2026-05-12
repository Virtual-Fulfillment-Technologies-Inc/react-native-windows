/**
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 *
 * @format
 * @ts-check
 */

const fs = require('fs');
const path = require('path');
const {series, task, tscTask} = require('just-scripts');

// Use the shared base configuration
require('@rnw-scripts/just-task');

const rnTesterPath = path.dirname(
  require.resolve('@react-native/tester/package.json'),
);

/** Windows Defender / indexing / IDE watchers often cause transient EBUSY on this package's `js` tree. */
const BUSY_CODES = new Set(['EBUSY', 'EPERM', 'EACCES']);

/** @param {number} ms */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
  } catch {
    const stop = Date.now() + ms;
    while (Date.now() < stop) {
      /* wait */
    }
  }
}

/**
 * @param {string} dir
 * @param {number} maxAttempts
 */
function rmDirRetry(dir, maxAttempts = 12) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, {recursive: true, force: true});
      }
      return;
    } catch (e) {
      const err = /** @type {NodeJS.ErrnoException} */ (e);
      if (BUSY_CODES.has(err.code) && attempt < maxAttempts) {
        sleepSync(Math.min(200 * attempt, 2500));
        continue;
      }
      throw e;
    }
  }
}

/**
 * @param {string} srcDir
 * @param {string} destDir
 * @param {number} maxAttempts
 */
function copyDirMergeRetry(srcDir, destDir, maxAttempts = 12) {
  fs.mkdirSync(destDir, {recursive: true});
  const entries = fs.readdirSync(srcDir, {withFileTypes: true});
  for (const ent of entries) {
    const srcPath = path.join(srcDir, ent.name);
    const destPath = path.join(destDir, ent.name);
    if (ent.isDirectory()) {
      copyDirMergeRetry(srcPath, destPath, maxAttempts);
    } else {
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          fs.copyFileSync(srcPath, destPath);
          break;
        } catch (e) {
          const err = /** @type {NodeJS.ErrnoException} */ (e);
          if (BUSY_CODES.has(err.code) && attempt < maxAttempts) {
            sleepSync(Math.min(200 * attempt, 2500));
            continue;
          }
          throw e;
        }
      }
    }
  }
}

task('cleanWin32TesterJs', () => {
  rmDirRetry(path.resolve('js'));
});

task('copyWin32TesterJsFromSrc', () => {
  copyDirMergeRetry(path.resolve('src/js'), path.resolve('js'));
});

task('copyWin32TesterJsFromRnTester', () => {
  copyDirMergeRetry(path.join(rnTesterPath, 'js'), path.resolve('js'));
});

task(
  'build',
  series(
    'cleanWin32TesterJs',
    'copyWin32TesterJsFromSrc',
    tscTask(),
    'copyWin32TesterJsFromRnTester',
  ),
);
