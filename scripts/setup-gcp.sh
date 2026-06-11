#!/bin/bash

# YANA/OGO Platform - Google Cloud Platform Setup Script
# This script sets up all required GCP resources for the platform

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}YANA/OGO Platform - GCP Setup${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo -e "${RED}Error: gcloud CLI is not installed${NC}"
    echo "Install it from: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Get project ID
read -p "Enter your GCP Project ID: " PROJECT_ID
if [ -z "$PROJECT_ID" ]; then
    echo -e "${RED}Error: Project ID is required${NC}"
    exit 1
fi

# Set project
echo -e "${YELLOW}Setting GCP project to: $PROJECT_ID${NC}"
gcloud config set project $PROJECT_ID

# Get region
read -p "Enter GCP region (default: us-central1): " REGION
REGION=${REGION:-us-central1}

echo ""
echo -e "${GREEN}Step 1: Enabling required APIs...${NC}"
gcloud services enable \
  sqladmin.googleapis.com \
  redis.googleapis.com \
  secretmanager.googleapis.com \
  translate.googleapis.com \
  texttospeech.googleapis.com \
  cloudlogging.googleapis.com \
  cloudmonitoring.googleapis.com \
  clouderrorreporting.googleapis.com \
  cloudtrace.googleapis.com \
  run.googleapis.com \
  vpcaccess.googleapis.com \
  compute.googleapis.com

echo ""
echo -e "${GREEN}Step 2: Creating service account...${NC}"
gcloud iam service-accounts create yana-ogo-sa \
  --display-name="YANA/OGO Service Account" \
  --project=$PROJECT_ID || echo "Service account already exists"

SERVICE_ACCOUNT="yana-ogo-sa@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant necessary roles
echo -e "${YELLOW}Granting IAM roles...${NC}"
gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/cloudtranslate.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/cloudtts.user"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/logging.logWriter"

gcloud projects add-iam-policy-binding $PROJECT_ID \
  --member="serviceAccount:${SERVICE_ACCOUNT}" \
  --role="roles/cloudtrace.agent"

echo ""
echo -e "${GREEN}Step 3: Creating Cloud SQL PostgreSQL instance...${NC}"
read -p "Create Cloud SQL instance? (y/n): " CREATE_SQL
if [ "$CREATE_SQL" = "y" ]; then
    gcloud sql instances create yana-ogo-db \
      --database-version=POSTGRES_15 \
      --tier=db-custom-2-7680 \
      --region=$REGION \
      --network=default \
      --no-assign-ip \
      --enable-bin-log \
      --backup-start-time=02:00 \
      --maintenance-window-day=SUN \
      --maintenance-window-hour=03 \
      --database-flags=max_connections=100 \
      --project=$PROJECT_ID

    echo -e "${YELLOW}Creating database...${NC}"
    gcloud sql databases create yana_ogo_production \
      --instance=yana-ogo-db \
      --project=$PROJECT_ID

    echo -e "${YELLOW}Creating database user...${NC}"
    read -sp "Enter database password: " DB_PASSWORD
    echo ""
    gcloud sql users create yana_ogo_app \
      --instance=yana-ogo-db \
      --password=$DB_PASSWORD \
      --project=$PROJECT_ID

    # Store password in Secret Manager
    echo -n "$DB_PASSWORD" | gcloud secrets create postgres-password \
      --data-file=- \
      --replication-policy="automatic" \
      --project=$PROJECT_ID || echo "Secret already exists"
fi

echo ""
echo -e "${GREEN}Step 4: Creating Cloud Memorystore Redis instance...${NC}"
read -p "Create Redis instance? (y/n): " CREATE_REDIS
if [ "$CREATE_REDIS" = "y" ]; then
    gcloud redis instances create yana-ogo-redis \
      --size=1 \
      --region=$REGION \
      --redis-version=redis_7_0 \
      --tier=basic \
      --network=default \
      --project=$PROJECT_ID

    REDIS_HOST=$(gcloud redis instances describe yana-ogo-redis \
      --region=$REGION \
      --format="get(host)" \
      --project=$PROJECT_ID)
    
    echo -e "${GREEN}Redis host: $REDIS_HOST${NC}"
fi

echo ""
echo -e "${GREEN}Step 5: Creating VPC Access Connector...${NC}"
read -p "Create VPC connector? (y/n): " CREATE_VPC
if [ "$CREATE_VPC" = "y" ]; then
    gcloud compute networks vpc-access connectors create yana-ogo-connector \
      --region=$REGION \
      --range=10.8.0.0/28 \
      --network=default \
      --project=$PROJECT_ID || echo "VPC connector already exists"
fi

echo ""
echo -e "${GREEN}Step 6: Setting up secrets in Secret Manager...${NC}"
echo "Please enter the following secrets (press Enter to skip):"

read -sp "Twilio Auth Token: " TWILIO_TOKEN
if [ ! -z "$TWILIO_TOKEN" ]; then
    echo -n "$TWILIO_TOKEN" | gcloud secrets create twilio-auth-token \
      --data-file=- \
      --replication-policy="automatic" \
      --project=$PROJECT_ID || echo "Secret already exists"
fi
echo ""

read -sp "Twilio Webhook Secret: " TWILIO_WEBHOOK
if [ ! -z "$TWILIO_WEBHOOK" ]; then
    echo -n "$TWILIO_WEBHOOK" | gcloud secrets create twilio-webhook-secret \
      --data-file=- \
      --replication-policy="automatic" \
      --project=$PROJECT_ID || echo "Secret already exists"
fi
echo ""

read -sp "LLM API Key: " LLM_KEY
if [ ! -z "$LLM_KEY" ]; then
    echo -n "$LLM_KEY" | gcloud secrets create llm-api-key \
      --data-file=- \
      --replication-policy="automatic" \
      --project=$PROJECT_ID || echo "Secret already exists"
fi
echo ""

read -sp "JWT Secret: " JWT_SECRET
if [ ! -z "$JWT_SECRET" ]; then
    echo -n "$JWT_SECRET" | gcloud secrets create jwt-secret \
      --data-file=- \
      --replication-policy="automatic" \
      --project=$PROJECT_ID || echo "Secret already exists"
fi
echo ""

# Grant service account access to secrets
echo -e "${YELLOW}Granting service account access to secrets...${NC}"
for secret in postgres-password twilio-auth-token twilio-webhook-secret llm-api-key jwt-secret; do
  gcloud secrets add-iam-policy-binding $secret \
    --member="serviceAccount:${SERVICE_ACCOUNT}" \
    --role="roles/secretmanager.secretAccessor" \
    --project=$PROJECT_ID 2>/dev/null || true
done

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "1. Update your .env.production file with the following:"
echo "   GCP_PROJECT_ID=$PROJECT_ID"
echo "   GCP_REGION=$REGION"
if [ ! -z "$REDIS_HOST" ]; then
    echo "   REDIS_HOST=$REDIS_HOST"
fi
echo ""
echo "2. Deploy to Cloud Run:"
echo "   npm run deploy:gcp:run"
echo ""
echo "3. Or deploy to App Engine:"
echo "   npm run deploy:gcp:appengine"
echo ""
echo "4. Or deploy to GKE:"
echo "   npm run deploy:gcp:gke"
echo ""
echo -e "${GREEN}Happy deploying! 🚀${NC}"
