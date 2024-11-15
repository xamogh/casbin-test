require('dotenv').config(); 

const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { newEnforcer } = require('casbin');
const { SequelizeAdapter } = require('casbin-sequelize-adapter');
const winston = require('winston');
const Joi = require('joi');
const path = require('path');

// Initialize Express app
const app = express();

// Middleware for security headers
app.use(helmet());

// Middleware for rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
// app.use(limiter);

// Middleware for parsing JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Initialize Winston logger
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }), // to include stack trace
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console()
  ],
});

// Initialize Casbin enforcer
let enforcer;

const initializeEnforcer = async () => {
  try {
    const adapter = await SequelizeAdapter.newAdapter({
      username: process.env.DB_USERNAME,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      dialect: process.env.DB_DIALECT,
      host: process.env.DB_HOST,
      logging: msg => logger.debug(msg), // Integrate Sequelize logging with Winston
    });
    enforcer = await newEnforcer(
      path.resolve(process.env.ENFORCER_MODEL_PATH),
      adapter
    );
    await enforcer.loadPolicy();
    logger.info('Enforcer initialized.');
  } catch (err) {
    logger.error('Failed to initialize enforcer: %o', err);
    process.exit(1); // Exit process if enforcer fails to initialize
  }
};

// Validation Schemas using Joi
const policySchema = Joi.object({
  sub: Joi.string().required(),
  obj: Joi.string().required(),
  act: Joi.string().required(),
});

const policiesSchema = Joi.object({
  policies: Joi.array().items(policySchema).required(),
});

const filteredPolicySchema = Joi.object({
  fieldIndex: Joi.number().integer().min(0).default(0),
  sub: Joi.string(),
  obj: Joi.string(),
  act: Joi.string(),
}).or('sub', 'obj', 'act'); // At least one filter field must be present

// Middleware to ensure enforcer is initialized
app.use((req, res, next) => {
  if (!enforcer) {
    logger.error('Enforcer not initialized.');
    return res.status(500).json({ error: 'Enforcer not initialized.' });
  }
  next();
});

// Route Handlers

// Add policy
app.post('/policy', async (req, res, next) => {
  try {
    const { error, value } = policySchema.validate(req.body);
    if (error) {
      logger.warn('Validation error: %o', error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { sub, obj, act } = value;
    const added = await enforcer.addPolicy(sub, obj, act);
    logger.info('Policy added: %o', value);
    res.status(200).json({ added });
  } catch (err) {
    logger.error('Failed to add policy: %o', err);
    next(err);
  }
});

// Add policies
app.post('/policies', async (req, res, next) => {
  try {
    const { error, value } = policiesSchema.validate(req.body);
    if (error) {
      logger.warn('Validation error: %o', error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { policies } = value;
    const added = await enforcer.addPolicies(policies);
    logger.info('Policies added: %o', policies);
    res.status(200).json({ added });
  } catch (err) {
    logger.error('Failed to add policies: %o', err);
    next(err);
  }
});

// Remove policy
app.delete('/policy', async (req, res, next) => {
  try {
    const { error, value } = policySchema.validate(req.body);
    if (error) {
      logger.warn('Validation error: %o', error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { sub, obj, act } = value;
    const removed = await enforcer.removePolicy(sub, obj, act);
    logger.info('Policy removed: %o', value);
    res.status(200).json({ removed });
  } catch (err) {
    logger.error('Failed to remove policy: %o', err);
    next(err);
  }
});

// Remove policies
app.delete('/policies', async (req, res, next) => {
  try {
    const { error, value } = policiesSchema.validate(req.body);
    if (error) {
      logger.warn('Validation error: %o', error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { policies } = value;
    const removed = await enforcer.removePolicies(policies);
    logger.info('Policies removed: %o', policies);
    res.status(200).json({ removed });
  } catch (err) {
    logger.error('Failed to remove policies: %o', err);
    next(err);
  }
});

// Get filtered policy
app.get('/policy', async (req, res, next) => {
  try {
    const { error, value } = filteredPolicySchema.validate(req.query);
    if (error) {
      logger.warn('Validation error: %o', error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { fieldIndex, sub, obj, act } = value;
    const filterValues = [sub, obj, act].filter(v => v !== undefined);
    const policies = await enforcer.getFilteredPolicy(
      Number(fieldIndex),
      ...filterValues
    );
    logger.info('Filtered policies retrieved: fieldIndex=%d, filters=%o', fieldIndex, filterValues);
    res.status(200).json({ policies });
  } catch (err) {
    logger.error('Failed to get filtered policy: %o', err);
    next(err);
  }
});

// Remove filtered policy
app.delete('/filtered_policy', async (req, res, next) => {
  try {
    const { error, value } = filteredPolicySchema.validate(req.body);
    if (error) {
      logger.warn('Validation error: %o', error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { fieldIndex, sub, obj, act } = value;
    const filterValues = [sub, obj, act].filter(v => v !== undefined);
    const removed = await enforcer.removeFilteredPolicy(
      Number(fieldIndex),
      ...filterValues
    );
    logger.info('Filtered policy removed: fieldIndex=%d, filters=%o', fieldIndex, filterValues);
    res.status(200).json({ removed });
  } catch (err) {
    logger.error('Failed to remove filtered policy: %o', err);
    next(err);
  }
});

// Enforce policy
app.post('/enforce', async (req, res, next) => {
  try {
    const { error, value } = policySchema.validate(req.body);
    if (error) {
      logger.warn('Validation error: %o', error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { sub, obj, act } = value;
    const allowed = await enforcer.enforce(sub, obj, act);
    logger.info('Policy enforced: %o, allowed=%s', value, allowed);
    res.status(200).json({ allowed });
  } catch (err) {
    logger.error('Failed to enforce policy: %o', err);
    next(err);
  }
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error('Unhandled error: %o', err);
  res.status(500).json({ error: 'Internal Server Error.' });
});

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found.' });
});

// Handle unhandled promise rejections and uncaught exceptions
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at: %o, reason: %o', promise, reason);
  // You might decide to shut down the process here
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception: %o', err);
  process.exit(1); // Mandatory (as per the Node.js docs)
});

// Start the server after initializing the enforcer
initializeEnforcer().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
});
