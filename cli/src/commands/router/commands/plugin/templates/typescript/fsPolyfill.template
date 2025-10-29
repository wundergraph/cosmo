import * as fs from 'fs';

// Polyfill for protobufjs which fails to load fs in bundled binaries
// protobufjs uses eval("require")("fs") which returns null in Bun compiled binaries
// We need to patch util.fs after protobufjs loads but before it's used

// Import protobufjs util and patch it
// Side-effect import to ensure google-protobuf is loaded
import 'google-protobuf';

// Try to find and patch protobufjs's util.fs
try {
  // Look for protobufjs in the bundled modules
  const protobufUtil = (globalThis as any).protobuf?.util;
  if (protobufUtil) {
    protobufUtil.fs = fs;
  }

  // Also try to patch via require if available
  if (typeof require !== 'undefined') {
    try {
      const util = require('protobufjs/src/util');
      if (util) {
        util.fs = fs;
      }
    } catch {
      // Module might not be available
    }
  }
} catch (e) {
  if (process.env.DEBUG) {
    console.error('[fsPolyfill] Warning: Failed to patch protobufjs util.fs:', e);
  }  
}

