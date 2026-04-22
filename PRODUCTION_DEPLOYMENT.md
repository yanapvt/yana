# 🚀 YANA/OGO Platform - Production Deployment Guide

This guide covers everything you need to deploy the YANA/OGO platform to production.

---

## 📋 **Pre-Deployment Checklist**

Before deploying to production, ensure you have:

- [ ] Production Twilio account with WhatsApp Business API access
- [ ] Production PostgreSQL database (managed service recommended)
- [ ] Production Redis instance (managed service recommended)
- [ ] LLM API key (OpenAI, Anthropic, or other provider)
- [ ] Translation API key (Google Translate, DeepL, or other)
- [ ] TTS API key (if enabling voice features)
- [ ] Nango account (for provider integrations)
- [ ] Domain name and SSL certificate
- [ ] Secrets management system (AWS Secrets Manager, HashiCorp Vault, etc.)
- [ ] Monitoring and logging infrastructure
- [ ] CI/CD pipeline configured

---

## 🔐 **1. Environment Configuration**

### **Create Production `.env` File**

**⚠️ CRITICAL: Never commit `.env` to version control!**

Create `.env.production` with the following:

```bash
# ============================================================================
# ENVIRONMENT
# ============================================================================
NODE_ENV=production
PORT=3000

# ============================================================================
# TWILIO / WHATSAPP
# ============================================================================
# Get these from: https://console.twilio.com
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_production_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
TWILIO_WEBHOOK_SECRET=your_webhook_validation_secret

# ============================================================================
# DATABASE - POSTGRESQL
# ============================================================================
# Use managed service: AWS RDS, Google Cloud SQL, Azure Database, etc.
POSTGRES_HOST=your-production-db.region.rds.amazonaws.com
POSTGRES_PORT=5432
POSTGRES_DB=yana_ogo_production
POSTGRES_USER=yana_ogo_app
POSTGRES_PASSWORD=your_strong_database_password_here

# Connection pool settings (optional)
POSTGRES_MAX_CONNECTIONS=20
POSTGRES_IDLE_TIMEOUT_MS=30000

# ============================================================================
# REDIS - STATE STORE
# ============================================================================
# Use managed service: AWS ElastiCache, Redis Cloud, Azure Cache, etc.
REDIS_HOST=your-production-redis.cache.amazonaws.com
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password_here
REDIS_DB=0
REDIS_TLS_ENABLED=true

# ============================================================================
# LLM PROVIDER
# ============================================================================
# OpenAI
LLM_PROVIDER=openai
LLM_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LLM_MODEL=gpt-4-turbo
LLM_CONFIDENCE_THRESHOLD=0.85
LLM_MAX_TOKENS=2000
LLM_TEMPERATURE=0.7

# Alternative: Anthropic Claude
# LLM_PROVIDER=anthropic
# LLM_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# LLM_MODEL=claude-3-opus-20240229

# ============================================================================
# TRANSLATION SERVICE
# ============================================================================
# Google Cloud Translation
TRANSLATION_PROVIDER=google
TRANSLATION_API_KEY=your_google_translation_api_key
TRANSLATION_DEFAULT_LANGUAGE=en
TRANSLATION_CONFIDENCE_THRESHOLD=0.7

# Alternative: DeepL
# TRANSLATION_PROVIDER=deepl
# TRANSLATION_API_KEY=your_deepl_api_key

# ============================================================================
# TEXT-TO-SPEECH (Optional)
# ============================================================================
TTS_PROVIDER=google
TTS_API_KEY=your_google_tts_api_key
TTS_ENABLED=true
TTS_VOICE_LANGUAGE_MAP={"en":"en-US-Neural2-D","es":"es-ES-Neural2-A"}

# ============================================================================
# NANGO INTEGRATION LAYER
# ============================================================================
# Get these from: https://app.nango.dev
NANGO_SECRET_KEY=your_nango_secret_key
NANGO_PUBLIC_KEY=your_nango_public_key
NANGO_HOST=https://api.nango.dev

# ============================================================================
# PAYMENT PROVIDERS
# ============================================================================
# Telco Billing Provider
TELCO_BILLING_PROVIDER=your_telco_provider
TELCO_BILLING_API_KEY=your_telco_api_key
TELCO_BILLING_WEBHOOK_SECRET=your_telco_webhook_secret

# Payment Link Provider (Stripe, PayPal, etc.)
PAYMENT_LINK_PROVIDER=stripe
PAYMENT_LINK_API_KEY=sk_live_xxxxxxxxxxxxxxxxxxxxxxxx
PAYMENT_LINK_WEBHOOK_SECRET=whsec_xxxxxxxxxxxxxxxxxxxxxxxx

# ============================================================================
# HOTEL SEARCH PROVIDERS
# ============================================================================
# Configure via Nango, but may need direct credentials
BOOKING_COM_API_KEY=your_booking_com_api_key
EXPEDIA_API_KEY=your_expedia_api_key

# ============================================================================
# FEATURE FLAGS
# ============================================================================
FEATURE_TTS_ENABLED=true
FEATURE_PROACTIVE_MESSAGING_ENABLED=true
FEATURE_VENDOR_CMS_ENABLED=true
FEATURE_ADMIN_INTERFACE_ENABLED=true

# ============================================================================
# OPERATIONAL SETTINGS
# ============================================================================
SESSION_TTL_SECONDS=7200
TOOL_RETRY_MAX_ATTEMPTS=3
TOOL_RETRY_DELAY_MS=1000
PAYMENT_TIMEOUT_MINUTES=15
BOOKING_HOLD_TIMEOUT_MINUTES=10

# Rate Limiting
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100

# ============================================================================
# SECURITY
# ============================================================================
# JWT for admin interface
JWT_SECRET=your_very_long_random_jwt_secret_here
JWT_EXPIRY=24h

# CORS
CORS_ALLOWED_ORIGINS=https://admin.yourdomain.com,https://yourdomain.com

# ============================================================================
# MONITORING & LOGGING
# ============================================================================
# Sentry for error tracking
SENTRY_DSN=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@sentry.io/xxxxxxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# DataDog / New Relic / CloudWatch
DATADOG_API_KEY=your_datadog_api_key
DATADOG_APP_KEY=your_datadog_app_key

# Log Level
LOG_LEVEL=info
LOG_FORMAT=json

# ============================================================================
# INFRASTRUCTURE
# ============================================================================
# AWS (if using AWS services)
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your_aws_access_key
AWS_SECRET_ACCESS_KEY=your_aws_secret_key

# Secrets Manager
SECRETS_MANAGER_ENABLED=true
SECRETS_MANAGER_REGION=us-east-1

# ============================================================================
# BACKUP & DISASTER RECOVERY
# ============================================================================
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30
```

---

## 🔒 **2. Secrets Management**

### **Option A: AWS Secrets Manager** (Recommended)

```bash
# Store secrets in AWS Secrets Manager
aws secretsmanager create-secret \
  --name yana-ogo/production/database \
  --secret-string '{
    "host": "your-db.rds.amazonaws.com",
    "port": 5432,
    "database": "yana_ogo_production",
    "user": "yana_ogo_app",
    "password": "your_password"
  }'

aws secretsmanager create-secret \
  --name yana-ogo/production/twilio \
  --secret-string '{
    "accountSid": "ACxxxx",
    "authToken": "your_token",
    "whatsappNumber": "whatsapp:+14155238886",
    "webhookSecret": "your_secret"
  }'

aws secretsmanager create-secret \
  --name yana-ogo/production/llm \
  --secret-string '{
    "provider": "openai",
    "apiKey": "sk-proj-xxxx",
    "model": "gpt-4-turbo"
  }'
```

**Update your code to load from Secrets Manager:**

```typescript
// src/config/secrets.ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

export async function loadSecrets() {
  const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
  
  const dbSecrets = await client.send(
    new GetSecretValueCommand({ SecretId: 'yana-ogo/production/database' })
  );
  
  const twilioSecrets = await client.send(
    new GetSecretValueCommand({ SecretId: 'yana-ogo/production/twilio' })
  );
  
  // Parse and merge with environment
  return {
    database: JSON.parse(dbSecrets.SecretString!),
    twilio: JSON.parse(twilioSecrets.SecretString!)
  };
}
```

### **Option B: HashiCorp Vault**

```bash
# Store secrets in Vault
vault kv put secret/yana-ogo/production/database \
  host=your-db.example.com \
  port=5432 \
  database=yana_ogo_production \
  user=yana_ogo_app \
  password=your_password

vault kv put secret/yana-ogo/production/twilio \
  accountSid=ACxxxx \
  authToken=your_token \
  whatsappNumber=whatsapp:+14155238886
```

### **Option C: Kubernetes Secrets** (if using K8s)

```yaml
# k8s-secrets.yaml
apiVersion: v1
kind: Secret
metadata:
  name: yana-ogo-secrets
type: Opaque
stringData:
  POSTGRES_PASSWORD: your_password
  TWILIO_AUTH_TOKEN: your_token
  LLM_API_KEY: sk-proj-xxxx
  REDIS_PASSWORD: your_redis_password
```

---

## 🗄️ **3. Database Setup**

### **Create Production Database**

```sql
-- Connect to PostgreSQL as admin
CREATE DATABASE yana_ogo_production;

-- Create application user
CREATE USER yana_ogo_app WITH PASSWORD 'your_strong_password';

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE yana_ogo_production TO yana_ogo_app;

-- Connect to the database
\c yana_ogo_production

-- Grant schema privileges
GRANT ALL ON SCHEMA public TO yana_ogo_app;
GRANT ALL ON ALL TABLES IN SCHEMA public TO yana_ogo_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO yana_ogo_app;
```

### **Run Migrations**

```bash
# Set production environment
export NODE_ENV=production

# Run migrations
npm run migrate:up

# Verify migrations
npm run migrate:status
```

### **Seed Initial Data**

```bash
# Seed hotel search schema
npm run seed:hotel-schema

# Seed other initial data
npm run seed:production
```

---

## 🔴 **4. Redis Setup**

### **Production Redis Configuration**

```bash
# If using AWS ElastiCache
aws elasticache create-cache-cluster \
  --cache-cluster-id yana-ogo-production \
  --cache-node-type cache.t3.medium \
  --engine redis \
  --engine-version 7.0 \
  --num-cache-nodes 1 \
  --preferred-availability-zone us-east-1a \
  --security-group-ids sg-xxxxxxxx

# Enable encryption at rest and in transit
aws elasticache modify-cache-cluster \
  --cache-cluster-id yana-ogo-production \
  --auth-token-enabled \
  --transit-encryption-enabled
```

### **Redis Connection Test**

```bash
# Test Redis connection
redis-cli -h your-redis-host.cache.amazonaws.com \
  -p 6379 \
  -a your_redis_password \
  --tls \
  PING
```

---

## 📞 **5. Twilio / WhatsApp Setup**

### **Configure Twilio Webhook**

1. Go to: https://console.twilio.com/us1/develop/sms/settings/whatsapp-sandbox
2. Set webhook URL: `https://yourdomain.com/webhook/whatsapp`
3. Set HTTP method: `POST`
4. Enable signature validation

### **WhatsApp Business API Setup**

```bash
# Request WhatsApp Business API access
# https://www.twilio.com/docs/whatsapp/api

# Configure your business profile
# - Business name
# - Business description
# - Business logo
# - Business category
# - Business website
```

### **Test Webhook**

```bash
# Test webhook with Twilio signature
curl -X POST https://yourdomain.com/webhook/whatsapp \
  -H "X-Twilio-Signature: your_signature" \
  -d "From=whatsapp:+1234567890" \
  -d "Body=Hello" \
  -d "MessageSid=SMxxxx"
```

---

## 🚀 **6. Deployment Options**

### **Option A: AWS Elastic Beanstalk**

```bash
# Install EB CLI
pip install awsebcli

# Initialize EB application
eb init -p node.js-18 yana-ogo-platform

# Create production environment
eb create yana-ogo-production \
  --instance-type t3.medium \
  --envvars NODE_ENV=production

# Deploy
eb deploy
```

### **Option B: Docker + AWS ECS**

```dockerfile
# Dockerfile
FROM node:18-alpine

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy source code
COPY . .

# Build TypeScript
RUN npm run build

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=40s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "dist/index.js"]
```

```bash
# Build and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin your-account.dkr.ecr.us-east-1.amazonaws.com

docker build -t yana-ogo-platform .
docker tag yana-ogo-platform:latest your-account.dkr.ecr.us-east-1.amazonaws.com/yana-ogo-platform:latest
docker push your-account.dkr.ecr.us-east-1.amazonaws.com/yana-ogo-platform:latest

# Deploy to ECS
aws ecs update-service \
  --cluster yana-ogo-cluster \
  --service yana-ogo-service \
  --force-new-deployment
```

### **Option C: Kubernetes**

```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: yana-ogo-platform
spec:
  replicas: 3
  selector:
    matchLabels:
      app: yana-ogo-platform
  template:
    metadata:
      labels:
        app: yana-ogo-platform
    spec:
      containers:
      - name: yana-ogo-platform
        image: your-registry/yana-ogo-platform:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        envFrom:
        - secretRef:
            name: yana-ogo-secrets
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
---
apiVersion: v1
kind: Service
metadata:
  name: yana-ogo-service
spec:
  selector:
    app: yana-ogo-platform
  ports:
  - protocol: TCP
    port: 80
    targetPort: 3000
  type: LoadBalancer
```

```bash
# Deploy to Kubernetes
kubectl apply -f k8s-secrets.yaml
kubectl apply -f k8s-deployment.yaml

# Check status
kubectl get pods
kubectl get services
```

### **Option D: Heroku** (Simplest)

```bash
# Install Heroku CLI
npm install -g heroku

# Login
heroku login

# Create app
heroku create yana-ogo-production

# Add PostgreSQL
heroku addons:create heroku-postgresql:standard-0

# Add Redis
heroku addons:create heroku-redis:premium-0

# Set environment variables
heroku config:set NODE_ENV=production
heroku config:set TWILIO_ACCOUNT_SID=ACxxxx
heroku config:set TWILIO_AUTH_TOKEN=your_token
# ... set all other env vars

# Deploy
git push heroku main

# Scale
heroku ps:scale web=2

# View logs
heroku logs --tail
```

---

## 📊 **7. Monitoring & Logging**

### **Set Up Sentry for Error Tracking**

```typescript
// src/index.ts
import * as Sentry from '@sentry/node';

if (process.env.NODE_ENV === 'production') {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV,
    tracesSampleRate: 0.1,
  });
}
```

### **Set Up CloudWatch Logs** (AWS)

```bash
# Install CloudWatch agent
npm install winston-cloudwatch

# Configure logging
# src/utils/logger.ts
import winston from 'winston';
import CloudWatchTransport from 'winston-cloudwatch';

const logger = winston.createLogger({
  transports: [
    new CloudWatchTransport({
      logGroupName: '/yana-ogo/production',
      logStreamName: 'application',
      awsRegion: process.env.AWS_REGION,
    })
  ]
});
```

### **Set Up Health Checks**

```typescript
// Enhanced health check endpoint
app.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {
      database: await checkDatabase(),
      redis: await checkRedis(),
      llm: await checkLLM(),
    }
  };
  
  const allHealthy = Object.values(health.checks).every(c => c.status === 'ok');
  res.status(allHealthy ? 200 : 503).json(health);
});
```

---

## 🔐 **8. Security Hardening**

### **Enable HTTPS Only**

```typescript
// Force HTTPS in production
if (process.env.NODE_ENV === 'production') {
  app.use((req, res, next) => {
    if (req.header('x-forwarded-proto') !== 'https') {
      res.redirect(`https://${req.header('host')}${req.url}`);
    } else {
      next();
    }
  });
}
```

### **Set Security Headers**

```bash
npm install helmet
```

```typescript
import helmet from 'helmet';

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));
```

### **Rate Limiting**

```typescript
import rateLimit from 'express-rate-limit';

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  message: 'Too many requests, please try again later.'
});

app.use('/webhook', limiter);
```

---

## 🧪 **9. Pre-Production Testing**

### **Run All Tests**

```bash
# Run full test suite
npm test

# Run property-based tests
npm test -- src/tests/properties/

# Check test coverage
npm run test:coverage
```

### **Load Testing**

```bash
# Install k6
brew install k6

# Run load test
k6 run load-test.js
```

```javascript
// load-test.js
import http from 'k6/http';
import { check } from 'k6';

export let options = {
  stages: [
    { duration: '2m', target: 100 }, // Ramp up to 100 users
    { duration: '5m', target: 100 }, // Stay at 100 users
    { duration: '2m', target: 0 },   // Ramp down
  ],
};

export default function () {
  let res = http.post('https://yourdomain.com/webhook/whatsapp', {
    From: 'whatsapp:+1234567890',
    Body: 'Test message',
    MessageSid: `SM${Date.now()}`
  });
  
  check(res, {
    'status is 200': (r) => r.status === 200,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });
}
```

---

## 📝 **10. Deployment Checklist**

Before going live:

- [ ] All environment variables configured
- [ ] Secrets stored in secure secrets manager
- [ ] Database migrations run successfully
- [ ] Redis connection tested
- [ ] Twilio webhook configured and tested
- [ ] LLM API key validated
- [ ] Translation API key validated
- [ ] Payment provider webhooks configured
- [ ] SSL certificate installed
- [ ] Domain DNS configured
- [ ] Health check endpoint responding
- [ ] Monitoring and logging configured
- [ ] Error tracking (Sentry) configured
- [ ] Backup strategy implemented
- [ ] Load testing completed
- [ ] Security headers enabled
- [ ] Rate limiting enabled
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Team trained on operations
- [ ] Incident response plan documented
- [ ] Rollback procedure documented

---

## 🚨 **11. Post-Deployment**

### **Monitor Key Metrics**

- Response time (target: < 500ms)
- Error rate (target: < 0.1%)
- Database connection pool usage
- Redis memory usage
- LLM API latency
- Webhook delivery success rate
- Booking conversion rate
- Payment success rate

### **Set Up Alerts**

```yaml
# Example CloudWatch alarms
- High error rate (> 1%)
- High response time (> 1s)
- Database connection failures
- Redis connection failures
- LLM API failures
- Low disk space
- High CPU usage (> 80%)
- High memory usage (> 80%)
```

### **Regular Maintenance**

- Daily: Check error logs
- Weekly: Review performance metrics
- Monthly: Database optimization
- Quarterly: Security audit
- Annually: Disaster recovery drill

---

## 📞 **Support & Troubleshooting**

### **Common Issues**

**Issue: Webhook signature validation fails**
- Check `TWILIO_WEBHOOK_SECRET` is correct
- Verify webhook URL in Twilio console
- Check server time is synchronized (NTP)

**Issue: Database connection timeout**
- Check security group allows connections
- Verify credentials are correct
- Check connection pool settings

**Issue: Redis connection fails**
- Verify TLS is enabled if required
- Check Redis password is correct
- Verify security group rules

**Issue: LLM API rate limits**
- Implement request queuing
- Add caching layer
- Consider upgrading API tier

---

## 🎉 **You're Ready for Production!**

Follow this guide step by step, and your YANA/OGO platform will be production-ready with:

✅ Secure configuration management  
✅ Scalable infrastructure  
✅ Comprehensive monitoring  
✅ Robust error handling  
✅ High availability  
✅ Disaster recovery  

**Good luck with your launch! 🚀**
