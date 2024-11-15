// stress_test.js

const axios = require('axios');
const { faker } = require('@faker-js/faker');

const SERVER_URL = 'http://localhost:3000'; 
const CONCURRENT_CLIENTS = 100; 
const REQUESTS_PER_CLIENT = 100; 

const ACTIONS = ['read', 'write', 'delete', 'update'];

const generateRandomPolicy = () => {
  return {
    sub: faker.internet.userName(),
    obj: faker.commerce.product(),
    act: faker.helpers.arrayElement(ACTIONS),
  };
};

const clientBehavior = async (clientId) => {
  console.log(`Client ${clientId} starting`);

  for (let i = 0; i < REQUESTS_PER_CLIENT; i++) {
    const endpointChoice = Math.floor(Math.random() * 4);
    const policy = generateRandomPolicy();

    try {
      switch (endpointChoice) {
        case 0:
          await axios.post(`${SERVER_URL}/policy`, policy);
          console.log(`Client ${clientId}: Added policy`, policy);
          break;

        case 1:
          const enforceResponse = await axios.post(`${SERVER_URL}/enforce`, policy);
          console.log(
            `Client ${clientId}: Enforce policy`,
            policy,
            'Result:',
            enforceResponse.data.allowed
          );
          break;

        case 2:
          await axios.delete(`${SERVER_URL}/policy`, { data: policy });
          console.log(`Client ${clientId}: Removed policy`, policy);
          break;

        case 3:
          const filterFieldIndex = Math.floor(Math.random() * 3); // 0, 1, or 2
          const filterValue = [policy.sub, policy.obj, policy.act][filterFieldIndex];
          const queryParam = ['sub', 'obj', 'act'][filterFieldIndex];
          const getResponse = await axios.get(`${SERVER_URL}/policy`, {
            params: { fieldIndex: filterFieldIndex, [queryParam]: filterValue },
          });
          console.log(`Client ${clientId}: Get filtered policy`, getResponse.data.policies);
          break;

        default:
          break;
      }
    } catch (error) {
      console.error(`Client ${clientId}: Error`, error.message);
    }
  }

  console.log(`Client ${clientId} finished`);
};

const startStressTest = async () => {
  console.log('Starting stress test with', CONCURRENT_CLIENTS, 'concurrent clients');

  const clientPromises = [];

  for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
    clientPromises.push(clientBehavior(i + 1));
  }

  await Promise.all(clientPromises);

  console.log('Stress test completed');
};

startStressTest();
