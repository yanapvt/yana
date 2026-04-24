# 🚀 YANA/OGO Platform - Google Cloud Platform Quick Start

Get your YANA/OGO platform running on Google Cloud Platform in minutes!

---

## 📋 **Prerequisites**

- Google Cloud Platform account with billing enabled
- [gcloud CLI](https://cloud.google.com/sdk/docs/install) installed
- Node.js 18+ installed
- Git installed

---

## ⚡ **Quick Setup (5 Minutes)**

### **Step 1: Clone and Install**

```bash
# Clone the repository
git clone https://github.com/yanapvt/yana.git
cd yana

# Install dependencies
npm install
```

### **Step 2: Run GCP Setup Script**

```bash
# Run the automated setup script
./scripts/setup-gcp.sh
```

This script will:
- ✅ Enable all required GCP APIs
- ✅ Create service account with proper permissions
- ✅ Create Cloud SQL PostgreSQL instance
- ✅ Create Cloud Memorystore Redis instance
- ✅ Create VPC Access Connector
- ✅ Store secrets in Secret Manager

### **Step 3: Deploy to Cloud Run**

```bash
# Deploy with one command
npm run deploy:gcp:run
```

That's it! Your platform is now live on Cloud Run! 🎉

---

## 🌐 **Alternative Deployment Options**

### **Option A: Cloud Run** (Recommended - Serverless)

```bash
npm run deploy:gcp:run
```

**Pros:**
- Fully managed, serverless
- Auto-scaling from 0 to N
- Pay only for what you use
- Built-in HTTPS
- Easy rollbacks

**Best for:** Most use cases, especially getting started

### **Option B: App Engine** (Fully Managed PaaS)

```bash
# Update app.yaml with your project ID
npm run deploy:gcp:appengine
```

**Pros:**
- Zero configuration
- Automatic scaling
- Built-in monitoring
- Traffic splitting for A/B testing

**Best for:** Simple deployments, minimal DevOps

### **Option C: Google Kubernetes Engine** (Full Control)

```bash
# Create GKE cluster
gcloud container clusters create yana-ogo-cluster \
  --region us-central1 \
  --num-nodes 2

# Deploy
npm run deploy:gcp:gke
```

**Pros:**
- Full Kubernetes control
- Multi-cloud portability
- Advanced networking
- Custom configurations

**Best for:** Large scale, complex requirements

---

## 🔧 **Configuration**

### **Environment Variables**

The platform uses these key environment variables:

```bash
# Google Cloud
GCP_PROJECT_ID=your-project-id
GCP_REGION=us-central1

# Database (Cloud SQL)
POSTGRES_HOST=/cloudsql/your-project-id:us-central1:yana-ogo-db
POSTGRES_DB=yana_ogo_production
POSTGRES_USER=yana_ogo_app

# Redis (Cloud Memorystore)
REDIS_HOST=10.xxx.xxx.xxx

# Twilio
TWILIO_ACCOUNT_SID=ACxxxx
TWILIO_WHATSAPP_NUMBER=whatsapp:+14155238886

# LLM (OpenAI or Vertex AI)
LLM_PROVIDER=openai
LLM_MODEL=gpt-4-turbo
```

### **Secrets (Stored in Secret Manager)**

These are automatically loaded from Secret Manager:
- `postgres-password` - Database password
- `twilio-auth-token` - Twilio authentication
- `twilio-webhook-secret` - Webhook validation
- `llm-api-key` - LLM API key
- `jwt-secret` - JWT signing key

---

## 🧪 **Testing Your Deployment**

### **1. Check Health Endpoint**

```bash
# Get your Cloud Run URL
gcloud run services describe yana-ogo-platform \
  --region us-central1 \
  --format="value(status.url)"

# Test health endpoint
curl https://your-service-url.run.app/health
```

### **2. Test Webhook**

```bash
curl -X POST https://your-service-url.run.app/webhook/whatsapp \
  -H "Content-Type: application/json" \
  -d '{
    "From": "whatsapp:+1234567890",
    "Body": "Hello",
    "MessageSid": "test123"
  }'
```

### **3. View Logs**

```bash
# View Cloud Run logs
gcloud run services logs read yana-ogo-platform \
  --region us-central1 \
  --limit 50
```

---

## 📊 **Monitoring**

### **Cloud Console**

Visit: https://console.cloud.google.com

- **Cloud Run**: See requests, latency, errors
- **Cloud SQL**: Monitor database performance
- **Cloud Logging**: View all application logs
- **Cloud Monitoring**: Set up alerts

### **Command Line**

```bash
# View service status
gcloud run services describe yana-ogo-platform --region us-central1

# View recent logs
gcloud logging read "resource.type=cloud_run_revision" --limit 20

# View errors
gcloud logging read "severity>=ERROR" --limit 10
```

---

## 💰 **Cost Estimate**

**Monthly costs for moderate usage:**

| Service | Configuration | Est. Cost |
|---------|--------------|-----------|
| Cloud Run | 1M requests/month | ~$50 |
| Cloud SQL | db-custom-2-7680 | ~$150 |
| Cloud Memorystore | 1GB Redis | ~$50 |
| Cloud Storage | Backups | ~$20 |
| Cloud Logging | Standard | ~$30 |
| Cloud Translation | 1M chars | ~$20 |
| Cloud Text-to-Speech | 1M chars | ~$16 |
| **Total** | | **~$350/month** |

**Cost optimization tips:**
- Use Cloud Run min-instances=0 for dev/staging
- Enable Cloud SQL automated backups only
- Use committed use discounts for production
- Set up budget alerts

---

## 🔐 **Security Checklist**

- [x] Secrets stored in Secret Manager (not in code)
- [x] Service account with least privilege
- [x] Cloud SQL private IP only
- [x] VPC Access Connector for internal traffic
- [x] HTTPS enforced (automatic with Cloud Run)
- [x] Cloud Armor for DDoS protection (optional)
- [x] Identity-Aware Proxy for admin interface (optional)

---

## 🚨 **Troubleshooting**

### **Issue: Cloud SQL connection fails**

```bash
# Check Cloud SQL Proxy is configured
gcloud sql instances describe yana-ogo-db

# Verify service account has cloudsql.client role
gcloud projects get-iam-policy your-project-id \
  --flatten="bindings[].members" \
  --filter="bindings.members:yana-ogo-sa"
```

### **Issue: Redis connection fails**

```bash
# Get Redis host
gcloud redis instances describe yana-ogo-redis --region us-central1

# Verify VPC connector is attached
gcloud run services describe yana-ogo-platform \
  --region us-central1 \
  --format="value(spec.template.spec.vpcAccess)"
```

### **Issue: Secrets not loading**

```bash
# List secrets
gcloud secrets list

# Check secret access
gcloud secrets get-iam-policy postgres-password
```

---

## 📚 **Next Steps**

1. **Configure Twilio Webhook**
   - Go to Twilio Console
   - Set webhook URL to your Cloud Run URL + `/webhook/whatsapp`

2. **Set Up Custom Domain**
   ```bash
   gcloud run domain-mappings create \
     --service yana-ogo-platform \
     --domain yourdomain.com \
     --region us-central1
   ```

3. **Enable Cloud CDN** (for static assets)
   ```bash
   gcloud compute backend-services update yana-ogo-backend \
     --enable-cdn \
     --global
   ```

4. **Set Up CI/CD**
   ```bash
   # Connect GitHub repository to Cloud Build
   gcloud builds triggers create github \
     --repo-name=yana \
     --repo-owner=yanapvt \
     --branch-pattern="^main$" \
     --build-config=cloudbuild.yaml
   ```

---

## 🎉 **You're Live on GCP!**

Your YANA/OGO platform is now running on Google Cloud Platform with:

✅ Serverless deployment on Cloud Run  
✅ Managed PostgreSQL database  
✅ Managed Redis cache  
✅ Secure secret management  
✅ Automatic scaling  
✅ Built-in monitoring and logging  
✅ HTTPS enabled  

**Need help?** Check the full deployment guide: `PRODUCTION_DEPLOYMENT_GCP.md`

**Happy building! 🚀**
