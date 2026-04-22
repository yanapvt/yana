#!/bin/bash

# Property Test 7.5: Low-Confidence LLM Fallback
# This script runs the property-based test for Property 9

echo "Running Property Test 9: Low-Confidence LLM Fallback"
echo "====================================================="
echo ""
echo "Property Statement:"
echo "For any LLM decision output with confidence below the configured threshold,"
echo "the Orchestrator SHALL respond with UI-based narrowing rather than proceeding"
echo "with execution."
echo ""
echo "Validates: Requirements 4.5"
echo ""
echo "Running test..."
echo ""

npx vitest --run src/tests/properties/low-confidence-llm-fallback.property.test.ts

echo ""
echo "Test execution complete."
