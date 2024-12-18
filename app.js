// app.js

require("dotenv").config(); // Load environment variables

const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { newEnforcer } = require("casbin");
const { SequelizeAdapter } = require("casbin-sequelize-adapter");
const winston = require("winston");
const DailyRotateFile = require("winston-daily-rotate-file");
const Joi = require("joi");
const path = require("path");
const morgan = require("morgan");
const fs = require("fs");
const jwt = require("jsonwebtoken"); // Import jsonwebtoken

// Initialize Express app
const app = express();

// Ensure log directory exists
const logDirectory = path.resolve(__dirname, process.env.LOG_DIR || "logs");
if (!fs.existsSync(logDirectory)) {
  fs.mkdirSync(logDirectory);
}

// Initialize Winston logger with multiple transports
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }), // Include stack traces
    winston.format.splat(),
    winston.format.json()
  ),
  transports: [
    // Console transport for real-time logging
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(), // Colorize output for console
        winston.format.simple()
      ),
    }),
    // Daily rotate file transport for combined logs
    new DailyRotateFile({
      filename: path.join(logDirectory, "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: process.env.LOG_MAX_SIZE || "20m",
      maxFiles: process.env.LOG_MAX_FILES || "14d",
      level: "info",
    }),
    // Daily rotate file transport for error logs
    new DailyRotateFile({
      filename: path.join(logDirectory, "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      zippedArchive: true,
      maxSize: process.env.LOG_MAX_SIZE || "20m",
      maxFiles: process.env.LOG_MAX_FILES || "30d",
      level: "error",
    }),
  ],
  exitOnError: false, // Do not exit on handled exceptions
});

// Stream for Morgan to use Winston
const morganStream = {
  write: (message) => {
    // Remove trailing newline
    logger.info(message.trim());
  },
};

// Middleware for security headers
app.use(helmet());

// Middleware for rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 60000, // 1 minute
  max: parseInt(process.env.RATE_LIMIT_MAX) || 100, // limit each IP to 100 requests per windowMs
  message: "Too many requests from this IP, please try again later.",
});
// app.use(limiter);

// Middleware for parsing JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Middleware for HTTP request logging using Morgan and Winston
app.use(
  morgan("combined", {
    stream: morganStream,
    skip: (req, res) => res.statusCode < 400, // Log only errors
  })
);

// JWT Authentication Middleware
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.warn("No Authorization header provided.");
    return res.status(401).json({ error: "Authorization header missing." });
  }

  const token = authHeader.split(" ")[1]; // Expecting format "Bearer <token>"

  if (!token) {
    logger.warn("No token provided in Authorization header.");
    return res.status(401).json({ error: "Token missing." });
  }

  jwt.verify(token, process.env.ACCESS_CONTROL_SIGNKEY, (err, decoded) => {
    if (err) {
      logger.warn("JWT verification failed:", err.message);
      return res.status(403).json({ error: "Invalid token." });
    }

    const { accountId } = decoded;

    if (accountId !== process.env.AWS_ACCOUNT_ID) {
      logger.warn("Invalid accountId in JWT:", accountId);
      return res.status(403).json({ error: "Unauthorized account ID." });
    }

    // Attach accountId to request object for further use if needed
    req.accountId = accountId;
    next();
  });
};

// Apply JWT Authentication Middleware to all routes except /health
app.use((req, res, next) => {
  if (req.path === "/health") {
    return next();
  }
  authenticateJWT(req, res, next);
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
      logging: (msg) => logger.debug(msg), // Integrate Sequelize logging with Winston
    });
    enforcer = await newEnforcer(
      path.resolve(process.env.ENFORCER_MODEL_PATH),
      adapter
    );
    await enforcer.loadPolicy();
    logger.info("Enforcer initialized.");
  } catch (err) {
    logger.error("Failed to initialize enforcer:", err);
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
}).or("sub", "obj", "act"); // At least one filter field must be present

// Middleware to ensure enforcer is initialized
app.use((req, res, next) => {
  if (!enforcer) {
    logger.error("Enforcer not initialized.");
    return res.status(500).json({ error: "Enforcer not initialized." });
  }
  next();
});

// Route Handlers

app.get("/policies", async (req, res, next) => {
  try {
    const policies = await enforcer.getPolicy();
    logger.info("All policies retrieved.");
    res.status(200).json({ policies });
  } catch (err) {
    logger.error("Failed to retrieve policies:", err);
    next(err);
  }
});

// Add policy
app.post("/policy", async (req, res, next) => {
  try {
    const { error, value } = policySchema.validate(req.body);
    if (error) {
      logger.warn("Validation error: %o", error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { sub, obj, act } = value;
    const added = await enforcer.addPolicy(sub, obj, act);
    if (added) {
      logger.info("Policy added: %o", value);
    } else {
      logger.warn("Policy already exists: %o", value);
    }
    res.status(200).json({ added });
  } catch (err) {
    logger.error("Failed to add policy:", err);
    next(err);
  }
});

// Add policies
app.post("/policies", async (req, res, next) => {
  try {
    const { error, value } = policiesSchema.validate(req.body);
    if (error) {
      logger.warn("Validation error: %o", error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { policies } = value;
    const added = await enforcer.addPolicies(policies);
    if (added.length > 0) {
      logger.info("Policies added: %o", added);
    } else {
      logger.warn("No new policies were added.");
    }
    res.status(200).json({ added: added.length });
  } catch (err) {
    logger.error("Failed to add policies:", err);
    next(err);
  }
});

// Remove policy
app.delete("/policy", async (req, res, next) => {
  try {
    const { error, value } = policySchema.validate(req.body);
    if (error) {
      logger.warn("Validation error: %o", error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { sub, obj, act } = value;
    const removed = await enforcer.removePolicy(sub, obj, act);
    if (removed) {
      logger.info("Policy removed: %o", value);
    } else {
      logger.warn("Policy not found for removal: %o", value);
    }
    res.status(200).json({ removed });
  } catch (err) {
    logger.error("Failed to remove policy:", err);
    next(err);
  }
});

// Remove policies
app.delete("/policies", async (req, res, next) => {
  try {
    const { error, value } = policiesSchema.validate(req.body);
    if (error) {
      logger.warn("Validation error: %o", error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { policies } = value;
    const removedPolicies = [];
    for (const policy of policies) {
      const removed = await enforcer.removePolicy(
        policy.sub,
        policy.obj,
        policy.act
      );
      if (removed) {
        removedPolicies.push(policy);
        logger.info("Policy removed: %o", policy);
      } else {
        logger.warn("Policy not found for removal: %o", policy);
      }
    }
    res.status(200).json({ removed: removedPolicies.length });
  } catch (err) {
    logger.error("Failed to remove policies:", err);
    next(err);
  }
});

// Get filtered policy
app.get("/policy", async (req, res, next) => {
  try {
    const { error, value } = filteredPolicySchema.validate(req.query);
    if (error) {
      logger.warn("Validation error: %o", error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { fieldIndex, sub, obj, act } = value;
    const filterValues = [sub, obj, act].filter((v) => v !== undefined);
    const policies = await enforcer.getFilteredPolicy(
      Number(fieldIndex),
      ...filterValues
    );
    logger.info(
      "Filtered policies retrieved: fieldIndex=%d, filters=%o",
      fieldIndex,
      filterValues
    );
    res.status(200).json({ policies });
  } catch (err) {
    logger.error("Failed to get filtered policy:", err);
    next(err);
  }
});

// Remove filtered policy
app.delete("/filtered_policy", async (req, res, next) => {
  try {
    const { error, value } = filteredPolicySchema.validate(req.body);
    if (error) {
      logger.warn("Validation error: %o", error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { fieldIndex, sub, obj, act } = value;
    const filterValues = [sub, obj, act].filter((v) => v !== undefined);
    const removed = await enforcer.removeFilteredPolicy(
      Number(fieldIndex),
      ...filterValues
    );
    logger.info(
      "Filtered policy removed: fieldIndex=%d, filters=%o",
      fieldIndex,
      filterValues
    );
    res.status(200).json({ removed });
  } catch (err) {
    logger.error("Failed to remove filtered policy:", err);
    next(err);
  }
});

// Enforce policy
app.post("/enforce", async (req, res, next) => {
  try {
    const { error, value } = policySchema.validate(req.body);
    if (error) {
      logger.warn("Validation error: %o", error.details);
      return res.status(400).json({ error: error.details[0].message });
    }
    const { sub, obj, act } = value;
    const allowed = await enforcer.enforce(sub, obj, act);
    logger.info("Policy enforced: %o, allowed=%s", value, allowed);
    res.status(200).json({ allowed });
  } catch (err) {
    logger.error("Failed to enforce policy:", err);
    next(err);
  }
});

// Health Check Endpoint (No Authentication)
app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

// Centralized Error Handling Middleware
app.use((err, req, res, next) => {
  logger.error("Unhandled error: %o", err);
  res.status(500).json({ error: "Internal Server Error." });
});

// Handle undefined routes
app.use((req, res) => {
  res.status(404).json({ error: "Route not found." });
});

// Handle unhandled promise rejections and uncaught exceptions
process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at: %o, reason: %o", promise, reason);
  // Optionally, notify developers or perform cleanup
});

process.on("uncaughtException", (err) => {
  logger.error("Uncaught Exception: %o", err);
  process.exit(1); // Exit to allow process manager to restart the app
});

// Start the server after initializing the enforcer
initializeEnforcer().then(() => {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
});
