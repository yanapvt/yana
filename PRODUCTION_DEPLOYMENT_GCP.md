# 🚀 YANA/OGO Platform - Google Cloud Platform Deployment Guide

This guide covers everything you need to deploy the YANA/OGO platform to production on Google Cloud Platform (GCP).

---

## 📋 **Pre-Deployment Checklist**

Before deploying to production, ensure you have:

- [ ] Google Cloud Platform account with billing enabled
- [ ] GCP Project created
- [ ] gcloud CLI installed and configured
- [ ] Production Twilio account with WhatsApp Business API access
- [ ] Cloud SQL PostgreSQL instance
- [ ] Cloud Memorystore Redis instance
- [ ] LLM API key (OpenAI, Anthropic, or Vertex AI)
- [ ] Cloud Translation API enabled
- [ ] Cloud Text-to-Speech API enabled
- [ ] Nango account (for provider integrations)
- [ ] Domain name configured in Cloud DNS
- [ ] SSL certificate (managed by Google Cloud Load Balancer)
- [ ] Cloud Logging and Cloud Monitoring configured

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
PORT=8080

# ============================================================================
# GOOGLE CLOUD PROJECT
# ============================================================================
GCP_PROJECT_ID=your-project-id
GCP_REGION=us-central1
GCP_ZONE=us-central1-a

# ============================================================================
# TWILIO / WHATSAPP
# ============================================================================
# Get these from: https://console.twilio.com
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_production_auth_token
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886
TWILIO_WEBHOOK_SECRET=your_webhook_validation_secret

# ============================================================================
# DATABASE - CLOUD SQL POSTGRESQL
# ============================================================================
# Cloud SQL connection
CLOUD_SQL_CONNECTION_NAME=your-project-id:us-central1:yana-ogo-db
POSTGRES_HOST=/cloudsql/your-project-id:us-central1:yana-ogo-db
POSTGRES_PORT=5432
POSTGRES_DB=yana_ogo_production
POSTGRES_USER=yana_ogo_app
POSTGRES_PASSWORD=your_strong_database_password_here

# Alternative: Public IP connection (not recommended for production)
# POSTGRES_HOST=35.xxx.xxx.xxx
# POSTGRES_SSL_MODE=require

# Connection pool settings
POSTGRES_MAX_CONNECTIONS=20
POSTGRES_IDLE_TIMEOUT_MS=30000

# ============================================================================
# REDIS - CLOUD MEMORYSTORE
# ============================================================================
REDIS_HOST=10.xxx.xxx.xxx
REDIS_PORT=6379
REDIS_DB=0
# Note: Cloud Memorystore for Redis doesn't require password in basic tier

# ============================================================================
# LLM PROVIDER
# ============================================================================
# Option 1: OpenAI
LLM_PROVIDER=openai
LLM_API_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
LLM_MODEL=gpt-4-turbo
LLM_CONFIDENCE_THRESHOLD=0.85

# Option 2: Google Vertex AI (recommended for GCP)
# LLM_PROVIDER=vertex-ai
# LLM_MODEL=gemini-1.5-pro
# LLM_CONFIDENCE_THRESHOLD=0.85
# VERTEX_AI_LOCATION=us-central1

# Option 3: Anthropic Claude
# LLM_PROVIDER=anthropic
# LLM_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
# LLM_MODEL=claude-3-opus-20240229

# ============================================================================
# TRANSLATION SERVICE - CLOUD TRANSLATION API
# ============================================================================
TRANSLATION_PROVIDER=google-cloud
TRANSLATION_DEFAULT_LANGUAGE=en
TRANSLATION_CONFIDENCE_THRESHOLD=0.7
# Authentication via Application Default Credentials (ADC)

# ============================================================================
# TEXT-TO-SPEECH - CLOUD TEXT-TO-SPEECH API
# ============================================================================
TTS_PROVIDER=google-cloud
TTS_ENABLED=true
TTS_VOICE_LANGUAGE_MAP={"en":"en-US-Neural2-D","es":"es-ES-Neural2-A","si":"si-LK-Standard-A"}
# Authentication via Application Default Credentials (ADC)

# ============================================================================
# NANGO INTEGRATION LAYER
# ============================================================================
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
# MONITORING & LOGGING - GOOGLE CLOUD
# ============================================================================
# Cloud Logging (automatic with GCP)
LOG_LEVEL=info
LOG_FORMAT=json

# Cloud Error Reporting (automatic with GCP)
ERROR_REPORTING_ENABLED=true

# Cloud Trace (automatic with GCP)
TRACE_ENABLED=true
TRACE_SAMPLE_RATE=0.1

# Optional: Sentry for additional error tracking
SENTRY_DSN=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@sentry.io/xxxxxxx
SENTRY_ENVIRONMENT=production
SENTRY_TRACES_SAMPLE_RATE=0.1

# ============================================================================
# SECRETS MANAGEMENT - SECRET MANAGER
# ============================================================================
SECRETS_MANAGER_ENABLED=true
# Secrets are accessed via Secret Manager API

# ============================================================================
# BACKUP & DISASTER RECOVERY
# ============================================================================
BACKUP_ENABLED=true
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30
BACKUP_BUCKET=gs://yana-ogo-backups
```

---

## 🔒 **2. Google Cloud Secret Manager Setup**

### **Enable Secret Manager API**

```bash
# Enable Secret Manager API
gcloud services enable secretmanager.googleapis.com

# Enable other required APIs
gcloud services enable \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  translate.googleapis.com \
  texttospeech.googleapis.com \
  cloudlogging.googleapis.com \
  cloudmonitoring.googleapis.com \
  clouderrorreporting.googleapis.com
```

### **Store Secrets in Secret Manager**

```bash
# Set your project ID
export PROJECT_ID=your-project-id
gcloud config set project $PROJECT_ID

# Store database credentials
echo -n "your_strong_password" | gcloud secrets create postgres-password \
  --data-file=- \
  --replication-policy="automatic"

# Store Twilio credentials
echo -n "your_twilio_auth_token" | gcloud secrets create twilio-auth-token \
  --data-file=- \
  --replication-policy="automatic"

echo -n "your_webhook_secret" | gcloud secrets create twilio-webhook-secret \
  --data-file=- \
  --replication-policy="automatic"

# Store LLM API key
echo -n "sk-proj-xxxx" | gcloud secrets create llm-api-key \
  --data-file=- \
  --replication-policy="automatic"

# Store payment provider secrets
echo -n "sk_live_xxxx" | gcloud secrets create stripe-api-key \
  --data-file=- \
  --replication-policy="automatic"

echo -n "whsec_xxxx" | gcloud secrets create stripe-webhook-secret \
  --data-file=- \
  --replication-policy="automatic"

# Store JWT secret
echo -n "your_jwt_secret" | gcloud secrets create jwt-secret \
  --data-file=- \
  --replication-policy="automatic"

# Store Nango credentials
echo -n "your_nango_secret" | gcloud secrets create nango-secret-key \
  --data-file=- \
  --replication-policy="automatic"
```

### **Grant Access to Secrets**

```bash
# Get your service account email
export SERVICE_ACCOUNT=yana-ogo-sa@${PROJECT_ID}.iam.gserviceaccount.com

# Grant access to all secrets
for secret in postgres-password twilio-auth-token twilio-webhook-secret \
  llm-api-key stripe-api-key stripe-webhook-secret jwt-secret nango-secret-key; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor"
done
```

---

## 🗄️ **3. Cloud SQL PostgreSQL Setup**

### **Create Cloud SQL Instance**

```bash
# Create PostgreSQL instance
gcloud sql instances create yana-ogo-db \
  --database-version=POSTGRES_15 \
  --tier=db-custom-2-7680 \
  --region=us-central1 \
  --network=default \
  --no-assign-ip \
  --enable-bin-log \
  --backup-start-time=02:00 \
  --maintenance-window-day=SUN \
  --maintenance-window-hour=03 \
  --database-flags=max_connections=100

# Create database
gcloud sql databases create yana_ogo_production \
  --instance=yana-ogo-db

# Create user
gcloud sql users create yana_ogo_app \
  --instance=yana-ogo-db \
  --password=your_strong_password
```

### **Enable Cloud SQL Proxy** (for local development)

```bash
# Download Cloud SQL Proxy
curl -o cloud-sql-proxy https://storage.googleapis.com/cloud-sql-connectors/cloud-sql-proxy/v2.8.0/cloud-sql-proxy.darwin.amd64
chmod +x cloud-sql-proxy

# Run proxy
./cloud-sql-proxy your-project-id:us-central1:yana-ogo-db
```

### **Run Migrations**

```bash
# Set environment
export NODE_ENV=production
export POSTGRES_HOST=/cloudsql/your-project-id:us-central1:yana-ogo-db

# Run migrations
npm run migrate:up

# Verify
npm run migrate:status
```

---

## 🔴 **4. Cloud Memorystore Redis Setup**

### **Create Redis Instance**

```bash
# Create Redis instance
gcloud redis instances create yana-ogo-redis \
  --size=1 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --tier=basic \
  --network=default

# Get Redis host IP
gcloud redis instances describe yana-ogo-redis \
  --region=us-central1 \
  --format="get(host)"
```

### **Test Redis Connection**

```bash
# Install redis-cli
brew install redis

# Test connection (from a VM in the same VPC)
redis-cli -h 10.xxx.xxx.xxx PING
```

---

## 📞 **5. Twilio / WhatsApp Setup**

Same as AWS version - Twilio configuration is cloud-agnostic.

### **Configure Twilio Webhook**

1. Go to: https://console.twilio.com/us1/develop/sms/settings/whatsapp-sandbox
2. Set webhook URL: `https://yourdomain.com/webhook/whatsapp`
3. Set HTTP method: `POST`
4. Enable signature validation

---

## 🚀 **6. Deployment Options**

### **Option A: Cloud Run** (Recommended - Serverless)

```bash
# Build and deploy to Cloud Run
gcloud run deploy yana-ogo-platform \
  --source . \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --set-env-vars NODE_ENV=production \
  --set-env-vars GCP_PROJECT_ID=your-project-id \
  --add-cloudsql-instances your-project-id:us-central1:yana-ogo-db \
  --vpc-connector yana-ogo-connector \
  --min-instances 1 \
  --max-instances 10 \
  --memory 1Gi \
  --cpu 1 \
  --timeout 300 \
  --service-account yana-ogo-sa@your-project-id.iam.gserviceaccount.com

# Set secrets from Secret Manager
gcloud run services update yana-ogo-platform \
  --region us-central1 \
  --update-secrets POSTGRES_PASSWORD=postgres-password:latest \
  --update-secrets TWILIO_AUTH_TOKEN=twilio-auth-token:latest \
  --update-secrets LLM_API_KEY=llm-api-key:latest \
  --update-secrets JWT_SECRET=jwt-secret:latest
```

**Create VPC Connector** (for Redis access):

```bash
# Enable VPC Access API
gcloud services enable vpcaccess.googleapis.com

# Create VPC connector
gcloud compute networks vpc-access connectors create yana-ogo-connector \
  --region us-central1 \
  --range 10.8.0.0/28 \
  --network default
```

### **Option B: Google Kubernetes Engine (GKE)**

```bash
# Create GKE cluster
gcloud container clusters create yana-ogo-cluster \
  --region us-central1 \
  --num-nodes 2 \
  --machine-type n1-standard-2 \
  --enable-autoscaling \
  --min-nodes 1 \
  --max-nodes 5 \
  --enable-autorepair \
  --enable-autoupgrade \
  --enable-ip-alias \
  --network default \
  --subnetwork default

# Get credentials
gcloud container clusters get-credentials yana-ogo-cluster --region us-central1

# Build and push to Container Registry
gcloud builds submit --tag gcr.io/your-project-id/yana-ogo-platform

# Deploy to GKE
kubectl apply -f k8s-gcp-deployment.yaml
```

**k8s-gcp-deployment.yaml:**

```yaml
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
      serviceAccountName: yana-ogo-sa
      containers:
      - name: yana-ogo-platform
        image: gcr.io/your-project-id/yana-ogo-platform:latest
        ports:
        - containerPort: 8080
        env:
        - name: NODE_ENV
          value: "production"
        - name: GCP_PROJECT_ID
          value: "your-project-id"
        - name: POSTGRES_HOST
          value: "/cloudsql/your-project-id:us-central1:yana-ogo-db"
        - name: REDIS_HOST
          value: "10.xxx.xxx.xxx"
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: yana-ogo-secrets
              key: postgres-password
        - name: TWILIO_AUTH_TOKEN
          valueFrom:
            secretKeyRef:
              name: yana-ogo-secrets
              key: twilio-auth-token
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
            port: 8080
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /health
            port: 8080
          initialDelaySeconds: 5
          periodSeconds: 5
      - name: cloud-sql-proxy
        image: gcr.io/cloud-sql-connectors/cloud-sql-proxy:2.8.0
        args:
          - "--structured-logs"
          - "--port=5432"
          - "your-project-id:us-central1:yana-ogo-db"
        securityContext:
          runAsNonRoot: true
---
apiVersion: v1
kind: Service
metadata:
  name: yana-ogo-service
spec:
  type: LoadBalancer
  selector:
    app: yana-ogo-platform
  ports:
  - protocol: TCP
    port: 80
    targetPort: 8080
```

### **Option C: App Engine** (Fully Managed)

**app.yaml:**

```yaml
runtime: nodejs18
env: standard
instance_class: F2

automatic_scaling:
  min_instances: 1
  max_instances: 10
  target_cpu_utilization: 0.65

env_variables:
  NODE_ENV: "production"
  GCP_PROJECT_ID: "your-project-id"

vpc_access_connector:
  name: "projects/your-project-id/locations/us-central1/connectors/yana-ogo-connector"

handlers:
- url: /.*
  script: auto
  secure: always
  redirect_http_response_code: 301
```

```bash
# Deploy to App Engine
gcloud app deploy app.yaml --project your-project-id
```

### **Option D: Compute Engine** (VMs)

```bash
# Create VM instance
gcloud compute instances create yana-ogo-vm \
  --zone=us-central1-a \
  --machine-type=n1-standard-2 \
  --image-family=ubuntu-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=20GB \
  --scopes=cloud-platform \
  --service-account=yana-ogo-sa@your-project-id.iam.gserviceaccount.com \
  --tags=http-server,https-server

# SSH into VM
gcloud compute ssh yana-ogo-vm --zone=us-central1-a

# Install Node.js and dependencies
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs git

# Clone repository
git clone https://github.com/yanapvt/yana.git
cd yana

# Install dependencies
npm install

# Build
npm run build

# Install PM2 for process management
sudo npm install -g pm2

# Start application
pm2 start dist/index.js --name yana-ogo

# Save PM2 configuration
pm2 save
pm2 startup
```

---

## 📊 **7. Monitoring & Logging**

### **Cloud Logging**

```bash
# View logs
gcloud logging read "resource.type=cloud_run_revision AND resource.labels.service_name=yana-ogo-platform" \
  --limit 50 \
  --format json

# Create log-based metric
gcloud logging metrics create error_rate \
  --description="Error rate metric" \
  --log-filter='severity>=ERROR'
```

### **Cloud Monitoring**

```bash
# Create uptime check
gcloud monitoring uptime create yana-ogo-uptime \
  --display-name="YANA/OGO Health Check" \
  --resource-type=uptime-url \
  --host=yourdomain.com \
  --path=/health \
  --period=60
```

### **Cloud Error Reporting**

Automatic with GCP - errors are automatically reported to Cloud Error Reporting.

### **Cloud Trace**

```typescript
// src/index.ts
import { TraceAgent } from '@google-cloud/trace-agent';

if (process.env.NODE_ENV === 'production') {
  TraceAgent.start({
    projectId: process.env.GCP_PROJECT_ID,
    samplingRate: 0.1
  });
}
```

---

## 🔐 **8. Security Hardening**

### **Service Account Setup**

```bash
# Create service account
gcloud iam service-accounts create yana-ogo-sa \
  --display-name="YANA/OGO Service Account"

# Grant necessary roles
gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:yana-ogo-sa@your-project-id.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:yana-ogo-sa@your-project-id.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:yana-ogo-sa@your-project-id.iam.gserviceaccount.com" \
  --role="roles/cloudtranslate.user"

gcloud projects add-iam-policy-binding your-project-id \
  --member="serviceAccount:yana-ogo-sa@your-project-id.iam.gserviceaccount.com" \
  --role="roles/cloudtts.user"
```

### **Cloud Armor** (DDoS Protection)

```bash
# Create security policy
gcloud compute security-policies create yana-ogo-policy \
  --description="YANA/OGO security policy"

# Add rate limiting rule
gcloud compute security-policies rules create 1000 \
  --security-policy yana-ogo-policy \
  --expression "true" \
  --action "rate-based-ban" \
  --rate-limit-threshold-count 100 \
  --rate-limit-threshold-interval-sec 60 \
  --ban-duration-sec 600
```

### **Identity-Aware Proxy** (for Admin Interface)

```bash
# Enable IAP
gcloud services enable iap.googleapis.com

# Configure IAP for backend service
gcloud compute backend-services update yana-ogo-backend \
  --iap=enabled \
  --global
```

---

## 🧪 **9. Pre-Production Testing**

### **Load Testing with Cloud Load Testing**

```bash
# Install artillery
npm install -g artillery

# Run load test
artillery run load-test-gcp.yml
```

**load-test-gcp.yml:**

```yaml
config:
  target: "https://yourdomain.com"
  phases:
    - duration: 120
      arrivalRate: 10
      name: "Warm up"
    - duration: 300
      arrivalRate: 50
      name: "Sustained load"
    - duration: 120
      arrivalRate: 100
      name: "Peak load"
  processor: "./load-test-processor.js"

scenarios:
  - name: "Webhook test"
    flow:
      - post:
          url: "/webhook/whatsapp"
          json:
            From: "whatsapp:+{{ $randomNumber() }}"
            Body: "Test message {{ $randomString() }}"
            MessageSid: "SM{{ $randomString() }}"
```

---

## 📝 **10. Deployment Checklist**

Before going live:

- [ ] GCP project created and billing enabled
- [ ] All required APIs enabled
- [ ] Service account created with proper permissions
- [ ] Cloud SQL PostgreSQL instance created
- [ ] Cloud Memorystore Redis instance created
- [ ] Secrets stored in Secret Manager
- [ ] Database migrations run successfully
- [ ] Cloud Run / GKE / App Engine deployed
- [ ] Domain configured with Cloud DNS
- [ ] SSL certificate configured (automatic with Cloud Load Balancer)
- [ ] Twilio webhook configured and tested
- [ ] Cloud Logging configured
- [ ] Cloud Monitoring alerts configured
- [ ] Cloud Error Reporting enabled
- [ ] Backup strategy implemented (Cloud SQL automated backups)
- [ ] Load testing completed
- [ ] Security policies configured (Cloud Armor)
- [ ] All tests passing
- [ ] Documentation updated
- [ ] Team trained on GCP operations

---

## 🚨 **11. Post-Deployment**

### **Monitor Key Metrics**

```bash
# View Cloud Run metrics
gcloud run services describe yana-ogo-platform \
  --region us-central1 \
  --format="value(status.url)"

# View Cloud SQL metrics
gcloud sql operations list --instance=yana-ogo-db

# View Redis metrics
gcloud redis instances describe yana-ogo-redis --region=us-central1
```

### **Set Up Alerts**

```bash
# Create alert policy for high error rate
gcloud alpha monitoring policies create \
  --notification-channels=CHANNEL_ID \
  --display-name="High Error Rate" \
  --condition-display-name="Error rate > 1%" \
  --condition-threshold-value=0.01 \
  --condition-threshold-duration=60s
```

---

## 💰 **12. Cost Optimization**

### **Estimated Monthly Costs** (US region)

- Cloud Run (1M requests/month): ~$50
- Cloud SQL (db-custom-2-7680): ~$150
- Cloud Memorystore Redis (1GB): ~$50
- Cloud Storage (backups): ~$20
- Cloud Logging: ~$30
- Cloud Translation API: ~$20/1M chars
- Cloud Text-to-Speech: ~$16/1M chars
- **Total: ~$350-500/month** (excluding API usage)

### **Cost Saving Tips**

```bash
# Use committed use discounts for Cloud SQL
gcloud sql instances patch yana-ogo-db \
  --pricing-plan=PACKAGE

# Enable autoscaling for Cloud Run
gcloud run services update yana-ogo-platform \
  --region us-central1 \
  --min-instances 0 \
  --max-instances 10

# Use preemptible VMs for non-critical workloads
gcloud compute instances create yana-ogo-worker \
  --preemptible \
  --machine-type n1-standard-1
```

---

## 📞 **Support & Troubleshooting**

### **Common Issues**

**Issue: Cloud SQL connection timeout**
- Verify Cloud SQL Proxy is running
- Check VPC connector configuration
- Verify service account has `cloudsql.client` role

**Issue: Redis connection fails**
- Verify VPC connector is attached to Cloud Run
- Check Redis instance is in same VPC
- Verify firewall rules allow traffic

**Issue: Secret Manager access denied**
- Verify service account has `secretmanager.secretAccessor` role
- Check secret exists: `gcloud secrets list`

**Issue: Cloud Translation API quota exceeded**
- Check quota: `gcloud services quota list --service=translate.googleapis.com`
- Request quota increase in GCP Console

---

## 🎉 **You're Ready for Production on GCP!**

Your YANA/OGO platform is now configured for Google Cloud Platform with:

✅ Cloud SQL PostgreSQL for durable storage  
✅ Cloud Memorystore Redis for session state  
✅ Secret Manager for secure credentials  
✅ Cloud Run for serverless deployment  
✅ Cloud Logging & Monitoring for observability  
✅ Cloud Translation & Text-to-Speech APIs  
✅ Cloud Armor for DDoS protection  
✅ Automated backups and disaster recovery  

**Good luck with your GCP deployment! 🚀**
