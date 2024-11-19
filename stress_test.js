// stress_test.js

require("dotenv").config(); // Load environment variables

const axios = require("axios");
const jwt = require("jsonwebtoken"); // Import jsonwebtoken
const { faker } = require("@faker-js/faker");

// Initialize Axios instance for casbinClient
const axiosInstance = axios.create({
  headers: {},
});

// Define casbinClient with methods to interact with the access control API
const casbinClient = {
  async addPolicy(sub, obj, act) {
    const url = `${process.env.ACCESS_CONTROL_URL}/policy`;
    const data = { sub, obj, act };
    const token = generateJWT();
    const response = await axiosInstance.post(url, data, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.added;
  },

  async addPolicies(policies) {
    const url = `${process.env.ACCESS_CONTROL_URL}/policies`;
    const data = { policies };
    const token = generateJWT();
    const response = await axiosInstance.post(url, data, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.added;
  },

  async removePolicy(sub, obj, act) {
    const url = `${process.env.ACCESS_CONTROL_URL}/policy`;
    const data = { sub, obj, act };
    const token = generateJWT();
    const response = await axiosInstance.delete(url, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.removed;
  },

  async removePolicies(policies) {
    const url = `${process.env.ACCESS_CONTROL_URL}/policies`;
    const data = { policies };
    const token = generateJWT();
    const response = await axiosInstance.delete(url, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.removed;
  },

  async getFilteredPolicy(fieldIndex, ...fieldValues) {
    const url = `${process.env.ACCESS_CONTROL_URL}/policy`;
    const params = { fieldIndex };
    const fieldNames = ["sub", "obj", "act"];

    for (let i = 0; i < fieldValues.length; i++) {
      const fieldName = fieldNames[fieldIndex + i];
      if (fieldName) {
        params[fieldName] = fieldValues[i];
      }
    }

    const token = generateJWT();
    const response = await axiosInstance.get(url, {
      params,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.policies;
  },

  async removeFilteredPolicy(fieldIndex, ...fieldValues) {
    const url = `${process.env.ACCESS_CONTROL_URL}/filtered_policy`;
    const data = { fieldIndex };
    const fieldNames = ["sub", "obj", "act"];

    for (let i = 0; i < fieldValues.length; i++) {
      const fieldName = fieldNames[fieldIndex + i];
      if (fieldName) {
        data[fieldName] = fieldValues[i];
      }
    }

    const token = generateJWT();
    const response = await axiosInstance.delete(url, {
      data,
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.removed;
  },

  async enforce(sub, obj, act) {
    const url = `${process.env.ACCESS_CONTROL_URL}/enforce`;
    const data = { sub, obj, act };
    const token = generateJWT();
    const response = await axiosInstance.post(url, data, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return response.data.allowed;
  },
};

// Function to generate JWT with accountId
const generateJWT = () => {
  const payload = {
    accountId: process.env.AWS_ACCOUNT_ID,
  };

  const token = jwt.sign(payload, process.env.ACCESS_CONTROL_SIGNKEY, {
    algorithm: "HS256", // Using HMAC SHA-256
    expiresIn: "1m", // Token expiration time
  });

  return token;
};

const SERVER_URL = process.env.ACCESS_CONTROL_URL || "http://localhost:3000";
const CONCURRENT_CLIENTS = 100;
const REQUESTS_PER_CLIENT = 100;

const ACTIONS = ["read", "write", "delete", "update"];

const generateRandomPolicy = () => {
  return {
    sub: faker.internet.username(),
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
          await casbinClient.addPolicy(policy.sub, policy.obj, policy.act);
          console.log(`Client ${clientId}: Added policy`, policy);
          break;

        case 1:
          const enforceResult = await casbinClient.enforce(
            policy.sub,
            policy.obj,
            policy.act
          );
          console.log(
            `Client ${clientId}: Enforce policy`,
            policy,
            "Result:",
            enforceResult
          );
          break;

        case 2:
          await casbinClient.removePolicy(policy.sub, policy.obj, policy.act);
          console.log(`Client ${clientId}: Removed policy`, policy);
          break;

        case 3:
          const filterFieldIndex = Math.floor(Math.random() * 3); // 0, 1, or 2
          const filterValue = [policy.sub, policy.obj, policy.act][
            filterFieldIndex
          ];
          const queryParam = ["sub", "obj", "act"][filterFieldIndex];
          const filteredPolicies = await casbinClient.getFilteredPolicy(
            filterFieldIndex,
            filterValue
          );
          console.log(
            `Client ${clientId}: Get filtered policy`,
            filteredPolicies
          );
          break;

        default:
          break;
      }
    } catch (error) {
      console.error(
        `Client ${clientId}: Error`,
        error.response ? error.response.data : error.message
      );
    }
  }

  console.log(`Client ${clientId} finished`);
};

const startStressTest = async () => {
  console.log(
    "Starting stress test with",
    CONCURRENT_CLIENTS,
    "concurrent clients"
  );

  const clientPromises = [];

  for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
    clientPromises.push(clientBehavior(i + 1));
  }

  await Promise.all(clientPromises);

  console.log("Stress test completed");
};

startStressTest();
