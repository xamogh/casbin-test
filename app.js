const express = require('express');
const bodyParser = require('body-parser');
const { newEnforcer } = require('casbin');
const { SequelizeAdapter } = require('casbin-sequelize-adapter');

const app = express();
app.use(bodyParser.json());

let enforcer;

const initializeEnforcer = async () => {
  try {
    const adapter = await SequelizeAdapter.newAdapter({
      username: 'postgres',
      password: 'xxxxxxx',
      database: 'casbin_rules',
      dialect: 'postgres',
      host: 'localhost',       
    });
    enforcer = await newEnforcer('config/model.conf', adapter);
    await enforcer.loadPolicy();
    console.log('Enforcer initialized.');
  } catch (err) {
    console.error('Failed to initialize enforcer:', err);
    process.exit(1); 
  }
};

// Middleware to ensure enforcer is initialized
app.use((req, res, next) => {
  if (!enforcer) {
    return res.status(500).json({ error: 'Enforcer not initialized.' });
  }
  next();
});

// Add policy
app.post('/policy', async (req, res) => {
  try {
    const { sub, obj, act } = req.body;
    const added = await enforcer.addPolicy(sub, obj, act);
    res.status(200).json({ added });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add policy.' });
  }
});

// Add policies
app.post('/policies', async (req, res) => {
  try {
    const policies = req.body.policies; 
    const added = await enforcer.addPolicies(policies);
    res.status(200).json({ added });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add policies.' });
  }
});

// Remove policy
app.delete('/policy', async (req, res) => {
  try {
    const { sub, obj, act } = req.body;
    const removed = await enforcer.removePolicy(sub, obj, act);
    res.status(200).json({ removed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove policy.' });
  }
});

// Remove policies
app.delete('/policies', async (req, res) => {
  try {
    const policies = req.body.policies;
    const removed = await enforcer.removePolicies(policies);
    res.status(200).json({ removed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove policies.' });
  }
});

// Get filtered policy
app.get('/policy', async (req, res) => {
  try {
    const { fieldIndex = 0, ...filter } = req.query;
    const policies = await enforcer.getFilteredPolicy(Number(fieldIndex), ...Object.values(filter));
    res.status(200).json({ policies });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get filtered policy.' });
  }
});

// Remove filtered policy
app.delete('/filtered_policy', async (req, res) => {
  try {
    const { fieldIndex = 0, ...filter } = req.body;
    const removed = await enforcer.removeFilteredPolicy(Number(fieldIndex), ...Object.values(filter));
    res.status(200).json({ removed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to remove filtered policy.' });
  }
});

// Enforce policy
app.post('/enforce', async (req, res) => {
  try {
    const { sub, obj, act } = req.body;
    const allowed = await enforcer.enforce(sub, obj, act);
    res.status(200).json({ allowed });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to enforce policy.' });
  }
});

// Start the server after initializing the enforcer
initializeEnforcer().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
  });
});
