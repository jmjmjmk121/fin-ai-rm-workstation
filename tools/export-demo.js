'use strict';

const fs = require('fs');
const path = require('path');
const {
  getWorkbench, prepareClientCase, rebalanceClient, stressClient, buildFrontierPayload,
  buildBusinessAnalyticsPayload, buildClientAnalyticsPayload,
} = require('../lib/workbench');
const { simulateCrisisBook } = require('../lib/crisis-simulation');

(async () => {
  const data = await getWorkbench();
  data.precomputed = {};
  for (const client of data.clients) {
    data.precomputed[client.id] = {
      prepare: prepareClientCase(client.id),
      rebalance: rebalanceClient(client.id),
      stress: Object.fromEntries(data.scenarios.map((scenario) => [scenario.id, stressClient(client.id, scenario.id)])),
    };
  }
  data.frontier = { global: buildFrontierPayload() };
  for (const client of data.clients) data.frontier[client.id] = buildFrontierPayload(client.id);
  data.analytics = {
    business: buildBusinessAnalyticsPayload(),
    clients: Object.fromEntries(data.clients.map((client) => [client.id, buildClientAnalyticsPayload(client.id)])),
  };
  data.simulation = { crisis: simulateCrisisBook({ clientCount: 3000, rmCount: 20, riskyAssetShock: -0.25 }) };
  const output = path.join(__dirname, '..', 'public', 'demo-data.json');
  fs.writeFileSync(output, JSON.stringify(data));
  console.log(`Wrote ${output}`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
