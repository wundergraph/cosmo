// Worker process for parallel-pool.mjs: runs a scenario N times and reports each completed task on stdout.
import { getScenario } from './scenarios.mjs';

const [, , scenarioName, tasksArg] = process.argv;
const scenario = getScenario(scenarioName);
for (let i = 1; i <= Number(tasksArg); i++) {
  const start = performance.now();
  scenario();
  console.log(`task ${i} done in ${(performance.now() - start).toFixed(0)}ms`);
}
