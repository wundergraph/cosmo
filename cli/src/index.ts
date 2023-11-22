#!/usr/bin/env node

import * as dotenv from 'dotenv';
import program from './commands/index.js';

dotenv.config();

await program.parseAsync(process.argv);
