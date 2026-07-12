// Structured logger - the single logging channel for the whole backend.
//
// Replaces bare console.log/error scattered across modules with one
// timestamped, component-tagged, leveled logger. Single-user local tool, so the
// default sink is the console; set LOG_FILE to also tee to a file (*.log is
// gitignored) for post-mortem troubleshooting without AI assistance.
//
// Levels (LOG_LEVEL env, default 'info'):
//   debug | info | warn | error
// A call below the threshold is a no-op, so debug instrumentation can stay in
// production code without noise.

import fs from 'node:fs';

const LEVELS = Object.freeze({
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
});

const DEFAULT_LEVEL = 'info';
const LEVEL_ORDER = ['debug', 'info', 'warn', 'error'];

/** Resolve the numeric threshold from LOG_LEVEL (case-insensitive), defaulting to info. */
function resolveThreshold() {
  const wanted = (process.env.LOG_LEVEL || DEFAULT_LEVEL).toLowerCase();
  return LEVELS[wanted] ?? LEVELS[DEFAULT_LEVEL];
}

const THRESHOLD = resolveThreshold();

// Optional file tee. Opened lazily and kept open for the process lifetime; the
// OS flushes on exit. Errors here never break the app - logging is best-effort.
let fileStream = null;
if (process.env.LOG_FILE) {
  try {
    fileStream = fs.createWriteStream(process.env.LOG_FILE, { flags: 'a' });
  } catch {
    fileStream = null; // fall back to console-only
  }
}

/** ISO timestamp with millisecond precision for log line prefixes. */
function timestamp() {
  return new Date().toISOString();
}

/** Map a level to the matching console method (debug has no console.debug in some runtimes). */
function consoleMethod(level) {
  if (level === 'debug') return console.log;
  if (level === 'warn') return console.warn;
  if (level === 'error') return console.error;
  return console.info;
}

/**
 * Emit one structured log line. Below-threshold calls return immediately.
 * @param {'debug'|'info'|'warn'|'error'} level
 * @param {string} tag component/provider id (e.g. 'server', 'chatgpt', 'scrape')
 * @param {string} msg human-readable message
 * @param {object} [extra] optional structured fields, JSON-appended
 */
function emit(level, tag, msg, extra) {
  if (LEVELS[level] < THRESHOLD) return;
  const suffix = extra ? ' ' + JSON.stringify(extra) : '';
  const line = `${timestamp()} ${level.toUpperCase().padEnd(5)} [${tag}] ${msg}${suffix}`;
  consoleMethod(level)(line);
  if (fileStream) fileStream.write(line + '\n');
}

/** Global logger keyed by level. Use log.info('server', 'listening', {port}). */
export const log = Object.fromEntries(
  LEVEL_ORDER.map((lvl) => [lvl, (tag, msg, extra) => emit(lvl, tag, msg, extra)]),
);

/**
 * Create a tag-bound logger so a module doesn't repeat its tag on every call.
 * @param {string} tag component/provider id
 * @returns {{debug:(m:string,e?:object)=>void, info:(m:string,e?:object)=>void, warn:(m:string,e?:object)=>void, error:(m:string,e?:object)=>void}}
 */
export function plog(tag) {
  return Object.fromEntries(
    LEVEL_ORDER.map((lvl) => [lvl, (msg, extra) => emit(lvl, tag, msg, extra)]),
  );
}
