#!/bin/bash

# Task 4.2: Run Webhook Signature Validation Property Test
# This script installs dependencies and runs the property test

set -e

echo "=========================================="
echo "Task 4.2: Webhook Signature Validation"
echo "Property-Based Test Execution"
echo "=========================================="
echo ""

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
    echo "✅ Dependencies installed"
    echo ""
fi

# Check if fast-check is installed
if ! npm list fast-check > /dev/null 2>&1; then
    echo "📦 Installing fast-check..."
    npm install --save-dev fast-check
    echo "✅ fast-check installed"
    echo ""
fi

echo "🧪 Running Property Test 1: Webhook Signature Validation"
echo ""
echo "This test will run 650+ test cases across 9 properties:"
echo "  1. Accept all requests with valid signatures"
echo "  2. Reject all requests with invalid signatures"
echo "  3. Reject requests with missing signatures"
echo "  4. Deterministic validation"
echo "  5. URL validation including query parameters"
echo "  6. Reject signatures valid for different body"
echo "  7. Reject signatures valid for different URL"
echo "  8. Always log Correlation_ID for rejections"
echo "  9. Timing-safe comparison"
echo ""

# Run the specific property test
npm test -- src/tests/properties/webhook-signature-validation.property.test.ts

echo ""
echo "=========================================="
echo "✅ Property Test Completed"
echo "=========================================="
