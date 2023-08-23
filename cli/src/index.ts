#!/usr/bin/env node

import program from './commands/index.js';

await program.parseAsync(process.argv);
