#!/usr/bin/env node
import { register } from 'tsx/esm/api';

register();
const { runContractCli } = await import('../server/contractCli.ts');
try {
  process.exitCode = await runContractCli();
} catch (error) {
  process.stderr.write(`Huccanta contract gate: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
}
