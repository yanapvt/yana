#!/bin/bash

# Seed search_hotels schema v1.0 into the database
# This script is idempotent and can be run multiple times safely

set -e

echo "🌱 Seeding search_hotels schema v1.0..."
echo ""

# Check if database is accessible
if ! psql "${DATABASE_URL:-postgresql://localhost:5432/yana_ogo}" -c "SELECT 1" > /dev/null 2>&1; then
  echo "❌ Error: Cannot connect to database"
  echo "   Make sure PostgreSQL is running and DATABASE_URL is set correctly"
  exit 1
fi

# Run the seed script
npx tsx src/db/seeds/seedSearchHotelsSchema.ts

echo ""
echo "✅ Seeding complete!"
echo ""
echo "To verify, run:"
echo "  psql \$DATABASE_URL -c \"SELECT * FROM schemas WHERE schema_name = 'search_hotels';\""
