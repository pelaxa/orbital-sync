#!/usr/bin/env node

import chalk from 'chalk';
import sleep from 'sleep-promise';
import { Log } from './log.js';
import { Sync } from './sync.js';
import { EnvironmentConfig } from './config/environment.js';

const config = new EnvironmentConfig();
const log = new Log(config.verboseMode);

do {
  await Sync.perform(config, { log });

  if (!config.runOnce) {
    log.info(chalk.dim(`Waiting ${config.intervalMinutes} minutes...`));
    await sleep(config.intervalMinutes * 60 * 1000);
  }
} while (!config.runOnce);
